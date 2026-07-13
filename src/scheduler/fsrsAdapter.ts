import {
  Rating as NativeRating,
  State as NativeState,
  createEmptyCard,
  fsrs,
  type Card as NativeCard,
  type Grade,
  type RecordLogItem as NativeRecordLogItem,
  type ReviewLog as NativeReviewLog,
} from 'ts-fsrs';
import { enforceMinimumRatingDelay } from './reviewPolicy';

export const DEFAULT_DESIRED_RETENTION = 0.9;
/** WordFlip UI policy: Anki warns that values above 0.97 can be overwhelming. */
export const MIN_DESIRED_RETENTION = 0.8;
export const MAX_DESIRED_RETENTION = 0.97;
export const MAXIMUM_INTERVAL_DAYS = 36_500;
export const MAX_SAFE_TIMESTAMP_MS = 8_640_000_000_000_000;
export const DEFAULT_LEARNING_STEPS = ['30m'] as const;
export const DEFAULT_RELEARNING_STEPS = ['30m'] as const;

const MAX_COUNT = 2_147_483_647;

export type FsrsRating = 'again' | 'hard' | 'good' | 'easy';
export type StoredFsrsState = 'new' | 'learning' | 'review' | 'relearning';
export type FsrsStep = `${number}${'m' | 'h' | 'd'}`;
export type FsrsTimestampInput = number | string | Date;

/**
 * IndexedDB/JSON-safe FSRS card state. Dates are epoch milliseconds rather
 * than Date instances so a round-trip through JSON does not change types.
 */
export interface StoredFsrsCard {
  dueAt: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: StoredFsrsState;
  lastReviewAt: number | null;
}

/** Minimal append-only input needed to deterministically rebuild a card. */
export interface StoredFsrsHistoryEntry {
  rating: FsrsRating;
  reviewedAt: FsrsTimestampInput;
}

/** JSON-safe diagnostic copy of the log returned by ts-fsrs. */
export interface StoredFsrsReviewLog {
  rating: FsrsRating;
  nativeRating: 1 | 2 | 3 | 4;
  state: StoredFsrsState;
  dueAt: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  lastElapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reviewedAt: number;
}

export interface FsrsRatingResult {
  card: StoredFsrsCard;
  log: StoredFsrsReviewLog;
}

export type FsrsPreview = Record<FsrsRating, FsrsRatingResult>;

export interface FsrsReplayResult {
  card: StoredFsrsCard;
  logs: StoredFsrsReviewLog[];
}

export interface FsrsAdapterOptions {
  /** Production should leave this enabled; tests can explicitly disable it. */
  enableFuzz?: boolean;
  /** 30-minute learning step by default. []여도 WordFlip 시간 하한은 유지된다. */
  learningSteps?: readonly FsrsStep[];
  /** 30-minute relearning step by default. []여도 WordFlip 시간 하한은 유지된다. */
  relearningSteps?: readonly FsrsStep[];
}

const RATING_TO_NATIVE: Record<FsrsRating, Grade> = {
  again: NativeRating.Again,
  hard: NativeRating.Hard,
  good: NativeRating.Good,
  easy: NativeRating.Easy,
};

const NATIVE_TO_RATING: Record<Grade, FsrsRating> = {
  [NativeRating.Again]: 'again',
  [NativeRating.Hard]: 'hard',
  [NativeRating.Good]: 'good',
  [NativeRating.Easy]: 'easy',
};

const STATE_TO_NATIVE: Record<StoredFsrsState, NativeState> = {
  new: NativeState.New,
  learning: NativeState.Learning,
  review: NativeState.Review,
  relearning: NativeState.Relearning,
};

const NATIVE_TO_STATE: Record<NativeState, StoredFsrsState> = {
  [NativeState.New]: 'new',
  [NativeState.Learning]: 'learning',
  [NativeState.Review]: 'review',
  [NativeState.Relearning]: 'relearning',
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function count(value: unknown, maximum = MAX_COUNT): number {
  return Math.trunc(clamp(finiteNumber(value, 0), 0, maximum));
}

function timestampValue(value: unknown): number | null {
  const raw =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'string'
        ? Date.parse(value)
        : typeof value === 'number'
          ? value
          : Number.NaN;
  if (!Number.isFinite(raw)) return null;
  return Math.trunc(clamp(raw, 0, MAX_SAFE_TIMESTAMP_MS));
}

function safeTimestamp(value: unknown, fallback: number): number {
  return timestampValue(value) ?? timestampValue(fallback) ?? 0;
}

function requiredTimestamp(value: unknown, label: string): number {
  const parsed = timestampValue(value);
  if (parsed === null) {
    throw new TypeError(`${label} must be a valid timestamp.`);
  }
  return parsed;
}

function normalizeState(value: unknown): StoredFsrsState {
  return typeof value === 'string' && value in STATE_TO_NATIVE
    ? (value as StoredFsrsState)
    : 'new';
}

function normalizeRating(value: unknown): FsrsRating {
  if (typeof value === 'string' && value in RATING_TO_NATIVE) {
    return value as FsrsRating;
  }
  throw new TypeError(`Unknown FSRS rating: ${String(value)}`);
}

function normalizeSteps(
  value: readonly FsrsStep[] | undefined,
): readonly FsrsStep[] {
  if (value === undefined) return [];
  for (const step of value) {
    const match = /^(\d+(?:\.\d+)?)(m|h|d)$/.exec(step);
    if (match === null || Number(match[1]) <= 0) {
      throw new TypeError(`Invalid FSRS learning step: ${step}`);
    }
  }
  return [...value];
}

/** Anki's supported desired-retention range, with 0.90 as a safe fallback. */
export function clampDesiredRetention(value: number): number {
  return clamp(
    finiteNumber(value, DEFAULT_DESIRED_RETENTION),
    MIN_DESIRED_RETENTION,
    MAX_DESIRED_RETENTION,
  );
}

export function fsrsCardToStored(
  card: NativeCard,
  fallbackNow: FsrsTimestampInput = Date.now(),
): StoredFsrsCard {
  const fallback = safeTimestamp(fallbackNow, Date.now());
  const nativeState =
    card.state in NATIVE_TO_STATE ? card.state : NativeState.New;
  return {
    dueAt: safeTimestamp(card.due, fallback),
    stability: clamp(
      finiteNumber(card.stability, 0),
      0,
      MAXIMUM_INTERVAL_DAYS,
    ),
    difficulty: clamp(finiteNumber(card.difficulty, 0), 0, 10),
    elapsedDays: count(card.elapsed_days),
    scheduledDays: count(card.scheduled_days, MAXIMUM_INTERVAL_DAYS),
    learningSteps: count(card.learning_steps),
    reps: count(card.reps),
    lapses: count(card.lapses),
    state: NATIVE_TO_STATE[nativeState],
    lastReviewAt:
      card.last_review === undefined
        ? null
        : timestampValue(card.last_review),
  };
}

export function storedCardToFsrs(
  stored: StoredFsrsCard,
  fallbackNow: FsrsTimestampInput = Date.now(),
): NativeCard {
  const fallback = safeTimestamp(fallbackNow, Date.now());
  const state = normalizeState(stored.state);
  const lastReviewAt = timestampValue(stored.lastReviewAt);
  const card: NativeCard = {
    due: new Date(safeTimestamp(stored.dueAt, fallback)),
    stability: clamp(
      finiteNumber(stored.stability, 0),
      0,
      MAXIMUM_INTERVAL_DAYS,
    ),
    difficulty: clamp(finiteNumber(stored.difficulty, 0), 0, 10),
    elapsed_days: count(stored.elapsedDays),
    scheduled_days: count(stored.scheduledDays, MAXIMUM_INTERVAL_DAYS),
    learning_steps: count(stored.learningSteps),
    reps: count(stored.reps),
    lapses: count(stored.lapses),
    state: STATE_TO_NATIVE[state],
  };
  if (lastReviewAt !== null) card.last_review = new Date(lastReviewAt);
  return card;
}

export function createStoredFsrsCard(
  now: FsrsTimestampInput = Date.now(),
): StoredFsrsCard {
  const at = safeTimestamp(now, Date.now());
  return fsrsCardToStored(createEmptyCard(new Date(at)), at);
}

function reviewLogToStored(log: NativeReviewLog): StoredFsrsReviewLog {
  const nativeRating =
    log.rating in NATIVE_TO_RATING
      ? (log.rating as Grade)
      : NativeRating.Again;
  const nativeState =
    log.state in NATIVE_TO_STATE ? log.state : NativeState.New;
  return {
    rating: NATIVE_TO_RATING[nativeRating],
    nativeRating,
    state: NATIVE_TO_STATE[nativeState],
    dueAt: safeTimestamp(log.due, 0),
    stability: clamp(
      finiteNumber(log.stability, 0),
      0,
      MAXIMUM_INTERVAL_DAYS,
    ),
    difficulty: clamp(finiteNumber(log.difficulty, 0), 0, 10),
    elapsedDays: count(log.elapsed_days),
    lastElapsedDays: count(log.last_elapsed_days),
    scheduledDays: count(log.scheduled_days, MAXIMUM_INTERVAL_DAYS),
    learningSteps: count(log.learning_steps),
    reviewedAt: safeTimestamp(log.review, 0),
  };
}

function resultToStored(result: NativeRecordLogItem): FsrsRatingResult {
  return {
    card: fsrsCardToStored(result.card, result.log.review),
    log: reviewLogToStored(result.log),
  };
}

function resultToStoredWithPolicy(
  result: NativeRecordLogItem,
  rating: FsrsRating,
  reviewedAt: number,
): FsrsRatingResult {
  const stored = resultToStored(result);
  return {
    ...stored,
    card: {
      ...stored.card,
      dueAt: enforceMinimumRatingDelay(
        stored.card.dueAt,
        reviewedAt,
        rating,
      ),
    },
  };
}

export class FsrsAdapter {
  readonly desiredRetention: number;
  readonly enableFuzz: boolean;
  readonly learningSteps: readonly FsrsStep[];
  readonly relearningSteps: readonly FsrsStep[];

  private readonly scheduler: ReturnType<typeof fsrs>;

  constructor(
    desiredRetention = DEFAULT_DESIRED_RETENTION,
    options: FsrsAdapterOptions = {},
  ) {
    this.desiredRetention = clampDesiredRetention(desiredRetention);
    this.enableFuzz = options.enableFuzz ?? true;
    this.learningSteps = normalizeSteps(
      options.learningSteps ?? DEFAULT_LEARNING_STEPS,
    );
    this.relearningSteps = normalizeSteps(
      options.relearningSteps ?? DEFAULT_RELEARNING_STEPS,
    );
    this.scheduler = fsrs({
      request_retention: this.desiredRetention,
      maximum_interval: MAXIMUM_INTERVAL_DAYS,
      enable_fuzz: this.enableFuzz,
      enable_short_term: true,
      learning_steps: this.learningSteps,
      relearning_steps: this.relearningSteps,
    });
  }

  preview(
    stored: StoredFsrsCard | null,
    now: FsrsTimestampInput = Date.now(),
  ): FsrsPreview {
    const at = safeTimestamp(now, Date.now());
    const card = this.cardForReview(stored, at);
    const reviewedAt = this.monotonicReviewTime(card, at);
    const preview = this.scheduler.repeat(card, new Date(reviewedAt));
    return {
      again: resultToStoredWithPolicy(
        preview[NativeRating.Again],
        'again',
        reviewedAt,
      ),
      hard: resultToStoredWithPolicy(
        preview[NativeRating.Hard],
        'hard',
        reviewedAt,
      ),
      good: resultToStoredWithPolicy(
        preview[NativeRating.Good],
        'good',
        reviewedAt,
      ),
      easy: resultToStoredWithPolicy(
        preview[NativeRating.Easy],
        'easy',
        reviewedAt,
      ),
    };
  }

  rate(
    stored: StoredFsrsCard | null,
    rating: FsrsRating,
    now: FsrsTimestampInput = Date.now(),
  ): FsrsRatingResult {
    const at = safeTimestamp(now, Date.now());
    const card = this.cardForReview(stored, at);
    const reviewedAt = this.monotonicReviewTime(card, at);
    const normalizedRating = normalizeRating(rating);
    const nativeRating = RATING_TO_NATIVE[normalizedRating];
    return resultToStoredWithPolicy(
      this.scheduler.next(card, new Date(reviewedAt), nativeRating),
      normalizedRating,
      reviewedAt,
    );
  }

  retrievability(
    stored: StoredFsrsCard,
    now: FsrsTimestampInput = Date.now(),
  ): number {
    const at = safeTimestamp(now, Date.now());
    try {
      const value = this.scheduler.get_retrievability(
        storedCardToFsrs(stored, at),
        new Date(at),
        false,
      );
      return clamp(finiteNumber(value, 0), 0, 1);
    } catch {
      // 손상된 외부 백업이 큐 전체를 멈추지 않도록 가장 낮은 회상률로 처리한다.
      return 0;
    }
  }

  /**
   * Rebuilds a card solely from append-only ratings and their actual review
   * timestamps. Input is stably sorted; the caller's array is never mutated.
   */
  replay(
    history: readonly StoredFsrsHistoryEntry[],
    createdAt: FsrsTimestampInput = Date.now(),
  ): FsrsReplayResult {
    const chronological = history
      .map((entry, index) => ({
        rating: normalizeRating(entry.rating),
        reviewedAt: requiredTimestamp(entry.reviewedAt, 'reviewedAt'),
        index,
      }))
      .sort(
        (a, b) => a.reviewedAt - b.reviewedAt || a.index - b.index,
      );
    const requestedCreatedAt = safeTimestamp(createdAt, Date.now());
    const actualCreatedAt =
      chronological.length === 0
        ? requestedCreatedAt
        : Math.min(requestedCreatedAt, chronological[0].reviewedAt);

    let card = createStoredFsrsCard(actualCreatedAt);
    const logs: StoredFsrsReviewLog[] = [];
    for (const entry of chronological) {
      const result = this.rate(card, entry.rating, entry.reviewedAt);
      card = result.card;
      logs.push(result.log);
    }
    return { card, logs };
  }

  private cardForReview(
    stored: StoredFsrsCard | null,
    now: number,
  ): NativeCard {
    return stored === null
      ? createEmptyCard(new Date(now))
      : storedCardToFsrs(stored, now);
  }

  private monotonicReviewTime(card: NativeCard, now: number): number {
    const lastReviewAt = timestampValue(card.last_review);
    return lastReviewAt === null ? now : Math.max(now, lastReviewAt);
  }
}

export function createFsrsAdapter(
  desiredRetention = DEFAULT_DESIRED_RETENTION,
  options: FsrsAdapterOptions = {},
): FsrsAdapter {
  return new FsrsAdapter(desiredRetention, options);
}
