import type {
  CardSchedule,
  LegacyCardSchedule,
  Rating,
  RatingCounts,
  ReviewLog,
  Settings,
} from '../types';
import { DEFAULT_SETTINGS, EMPTY_RATING_COUNTS } from '../types';
import {
  MAXIMUM_INTERVAL_DAYS,
  MAX_SAFE_TIMESTAMP_MS,
  clampDesiredRetention,
  createFsrsAdapter,
  type StoredFsrsCard,
} from '../scheduler/fsrsAdapter';
import { getMeta, setMeta, type WordFlipDB } from '../db/database';
import { META_KEYS, type StudySession } from '../db/schema';
import { uid } from '../utils/uid';
import {
  nextReviewStreak,
  normalizeReviewStreak,
  ratingCardGap,
} from '../scheduler/reviewPolicy';

export {
  MAX_AGAIN_CARD_GAP,
  MAX_HARD_CARD_GAP,
  MIN_AGAIN_CARD_GAP,
  MIN_HARD_CARD_GAP,
} from '../scheduler/reviewPolicy';

const MAX_RECENT_KEPT = 30;
const CURRENT_SCHEDULER_VERSION = 3 as const;

export interface ApplyRatingOptions {
  /** 평가와 한 트랜잭션으로 저장할 다음 화면 상태 */
  studySession?: StudySession;
  /** 테스트와 로그 재생용 고정 시각. */
  nowMs?: number;
  /** 테스트에서는 false로 두어 간격 fuzz를 결정적으로 만들 수 있다. */
  enableFuzz?: boolean;
}

export interface ReviewOutcome {
  schedule: CardSchedule;
  log: ReviewLog;
  studyStep: number;
  recentIds: string[];
  reviewStreak: number;
  ratingCounts: RatingCounts;
}

interface UndoSnapshot {
  logId: string;
  cardId: string;
  prevSchedule: CardSchedule | null;
  prevStudyStep: number;
  prevRecentIds: string[];
  prevReviewStreak: number;
  /** 옛 snapshot에는 없으므로 undo 시 true 여부만 사용한다. */
  reviewedWasDue?: boolean;
  prevRatingCounts: RatingCounts;
  prevStudyMode: StudySession['mode'] | null;
}

export interface UndoOutcome {
  cardId: string;
  schedule: CardSchedule | null;
  studyStep: number;
  recentIds: string[];
  reviewStreak: number;
  wasDueReview: boolean;
  ratingCounts: RatingCounts;
  studyMode: StudySession['mode'] | null;
}

export interface UndoReviewOptions {
  studyMode?: StudySession['mode'];
}

let ratingInFlight = false;

export function isRatingInFlight(): boolean {
  return ratingInFlight;
}

/**
 * 평가 1회를 원자적으로 처리한다. studyStep은 이제 시간 간격 계산에 쓰지 않고,
 * 누적 평가 횟수와 Again/Hard 카드의 최소 카드 간격에만 사용한다.
 */
export async function applyRating(
  dbi: WordFlipDB,
  cardId: string,
  rating: Rating,
  wasDueReview: boolean,
  options: ApplyRatingOptions = {},
): Promise<ReviewOutcome> {
  if (ratingInFlight) throw new Error('이전 평가가 아직 처리 중입니다.');
  ratingInFlight = true;
  try {
    return await dbi.transaction(
      'rw',
      [dbi.schedules, dbi.reviewLogs, dbi.meta],
      async () => {
        const rawStep = await getMeta(dbi, META_KEYS.studyStep, 0);
        const stepBefore = safeNonNegativeInteger(rawStep);
        const stepAfter = stepBefore + 1;
        const nowMs = safeTimestamp(options.nowMs ?? Date.now(), Date.now());
        const settings = normalizeSettings(
          await getMeta<Settings>(dbi, META_KEYS.settings, DEFAULT_SETTINGS),
        );
        const adapter = createFsrsAdapter(settings.desiredRetention, {
          enableFuzz: options.enableFuzz ?? true,
        });

        const stored = (await dbi.schedules.get(cardId)) as unknown;
        const prev = isFsrsSchedule(stored) ? stored : null;
        const rated = adapter.rate(prev, rating, nowMs);
        const logId = uid();
        const minReviewStep =
          stepAfter + ratingCardGap(rating, `${logId}:${cardId}:${nowMs}`);
        const schedule: CardSchedule = {
          cardId,
          ...rated.card,
          minReviewStep,
          lastRating: rating,
          algorithm: 'fsrs-6',
        };

        const log: ReviewLog = {
          id: logId,
          cardId,
          stepBefore,
          stepAfter,
          rating,
          intervalBefore: prev?.scheduledDays ?? 0,
          intervalAfter: schedule.scheduledDays,
          schedulerVersion: CURRENT_SCHEDULER_VERSION,
          scheduleAfter: { ...schedule },
          reviewedAt: new Date(nowMs).toISOString(),
        };

        const prevRecent = await getMeta<string[]>(dbi, META_KEYS.recentIds, []);
        const recentIds = [...prevRecent.filter((id) => id !== cardId), cardId].slice(
          -MAX_RECENT_KEPT,
        );
        const prevStreak = await getMeta(dbi, META_KEYS.reviewStreak, 0);
        const reviewStreak = nextReviewStreak(prevStreak, wasDueReview);
        const prevCounts = await getMeta<RatingCounts>(
          dbi,
          META_KEYS.ratingCounts,
          EMPTY_RATING_COUNTS,
        );
        const ratingCounts = {
          ...EMPTY_RATING_COUNTS,
          ...prevCounts,
          [rating]: (prevCounts[rating] ?? 0) + 1,
        };
        const undo: UndoSnapshot = {
          logId,
          cardId,
          prevSchedule: prev,
          prevStudyStep: stepBefore,
          prevRecentIds: prevRecent,
          prevReviewStreak: normalizeReviewStreak(prevStreak),
          reviewedWasDue: wasDueReview,
          prevRatingCounts: { ...EMPTY_RATING_COUNTS, ...prevCounts },
          prevStudyMode: options.studySession?.mode ?? null,
        };

        const writes: PromiseLike<unknown>[] = [
          setMeta(dbi, META_KEYS.studyStep, stepAfter),
          dbi.schedules.put(schedule),
          dbi.reviewLogs.add(log),
          setMeta(dbi, META_KEYS.recentIds, recentIds),
          setMeta(dbi, META_KEYS.reviewStreak, reviewStreak),
          setMeta(dbi, META_KEYS.ratingCounts, ratingCounts),
          setMeta(dbi, META_KEYS.lastUndo, undo),
        ];
        if (options.studySession) {
          writes.push(setMeta(dbi, META_KEYS.studySession, options.studySession));
        }
        await Promise.all(writes);

        return {
          schedule,
          log,
          studyStep: stepAfter,
          recentIds,
          reviewStreak,
          ratingCounts,
        };
      },
    );
  } finally {
    ratingInFlight = false;
  }
}

/** 마지막 평가 한 번 되돌리기 */
export async function undoLastReview(
  dbi: WordFlipDB,
  options: UndoReviewOptions = {},
): Promise<UndoOutcome | null> {
  return dbi.transaction(
    'rw',
    [dbi.schedules, dbi.reviewLogs, dbi.meta],
    async () => {
      const undo = await getMeta<UndoSnapshot | null>(dbi, META_KEYS.lastUndo, null);
      if (undo === null) return null;
      const restoredMode = undo.prevStudyMode ?? options.studyMode ?? null;
      const wasDueReview = undo.reviewedWasDue === true;

      if (undo.prevSchedule === null) await dbi.schedules.delete(undo.cardId);
      else await dbi.schedules.put(undo.prevSchedule);

      const writes: PromiseLike<unknown>[] = [
        dbi.reviewLogs.delete(undo.logId),
        setMeta(dbi, META_KEYS.studyStep, undo.prevStudyStep),
        setMeta(dbi, META_KEYS.recentIds, undo.prevRecentIds),
        setMeta(dbi, META_KEYS.reviewStreak, undo.prevReviewStreak),
        setMeta(dbi, META_KEYS.ratingCounts, undo.prevRatingCounts),
        setMeta(dbi, META_KEYS.lastUndo, null),
      ];
      if (restoredMode) {
        writes.push(
          setMeta(dbi, META_KEYS.studySession, {
            mode: restoredMode,
            currentCardId: undo.cardId,
            flipped: false,
            currentWasDue: wasDueReview,
          } satisfies StudySession),
        );
      }
      await Promise.all(writes);

      return {
        cardId: undo.cardId,
        schedule: undo.prevSchedule,
        studyStep: undo.prevStudyStep,
        recentIds: undo.prevRecentIds,
        reviewStreak: undo.prevReviewStreak,
        wasDueReview,
        ratingCounts: undo.prevRatingCounts,
        studyMode: restoredMode,
      };
    },
  );
}

/**
 * v1/v2 IndexedDB 또는 옛 JSON 백업의 step 스케줄을 실제 reviewedAt 기록으로
 * best-effort 재생한다. 옛 dueStep을 날짜로 가장하지 않는다.
 */
export async function migrateLegacySchedulesToFsrs(
  dbi: WordFlipDB,
): Promise<{ migrated: boolean; schedules: CardSchedule[] }> {
  const [pending, rawSchedules] = await Promise.all([
    getMeta(dbi, META_KEYS.fsrsMigrationPending, false),
    dbi.schedules.toArray() as unknown as Promise<unknown[]>,
  ]);
  const hasLegacy = rawSchedules.some((schedule) => !isFsrsSchedule(schedule));
  if (!pending && !hasLegacy) {
    return { migrated: false, schedules: rawSchedules as CardSchedule[] };
  }

  const rebuilt = await rebuildSchedulesFromLogs(dbi, {
    legacySchedules: rawSchedules,
    finishMigration: true,
  });
  return { migrated: true, schedules: rebuilt.schedules };
}

interface RebuildOptions {
  legacySchedules?: readonly unknown[];
  finishMigration?: boolean;
}

/** append-only 로그를 실제 시각 순으로 재생하여 FSRS 상태를 복구한다. */
export async function rebuildSchedulesFromLogs(
  dbi: WordFlipDB,
  options: RebuildOptions = {},
): Promise<{ studyStep: number; schedules: CardSchedule[] }> {
  return dbi.transaction(
    'rw',
    [dbi.cards, dbi.schedules, dbi.reviewLogs, dbi.meta],
    async () => {
      const [cards, logs, storedSettings, currentStep, currentSchedules] =
        await Promise.all([
          dbi.cards.toArray(),
          dbi.reviewLogs.toArray(),
          getMeta<Settings>(dbi, META_KEYS.settings, DEFAULT_SETTINGS),
          getMeta(dbi, META_KEYS.studyStep, 0),
          options.legacySchedules
            ? Promise.resolve([...options.legacySchedules])
            : (dbi.schedules.toArray() as unknown as Promise<unknown[]>),
        ]);
      const settings = normalizeSettings(storedSettings);
      const adapter = createFsrsAdapter(settings.desiredRetention, {
        enableFuzz: false,
      });
      const cardIds = new Set(cards.map((card) => card.id));
      const byCard = new Map<string, ReviewLog[]>();
      for (const log of logs) {
        if (!cardIds.has(log.cardId)) continue;
        const list = byCard.get(log.cardId) ?? [];
        list.push(log);
        byCard.set(log.cardId, list);
      }

      const schedules: CardSchedule[] = [];
      const withLogs = new Set<string>();
      for (const [cardId, cardLogs] of byCard) {
        withLogs.add(cardId);
        const chronological = cardLogs.slice().sort(compareLogs);
        let schedule: CardSchedule | null = null;
        for (const log of chronological) {
          if (
            log.schedulerVersion === CURRENT_SCHEDULER_VERSION &&
            isFsrsSchedule(log.scheduleAfter) &&
            log.scheduleAfter.cardId === cardId
          ) {
            schedule = { ...log.scheduleAfter };
            continue;
          }
          const at = reviewTimestamp(log);
          const rated = adapter.rate(schedule, log.rating, at);
          schedule = {
            cardId,
            ...rated.card,
            minReviewStep: safeNonNegativeInteger(log.stepAfter),
            lastRating: log.rating,
            algorithm: 'fsrs-6',
          };
        }
        if (schedule) schedules.push(schedule);
      }

      // 로그가 없는 유효 FSRS 상태는 그대로 보존한다. 옛 schedule만 남은 카드는
      // lastRating으로 보수적으로 초기화하되, 다음 실행에서 한 번 확인할 수 있게 due.
      const nowMs = Date.now();
      for (const raw of currentSchedules) {
        const cardId = getCardId(raw);
        if (cardId === null || !cardIds.has(cardId) || withLogs.has(cardId)) continue;
        if (isFsrsSchedule(raw)) {
          schedules.push({ ...raw });
          continue;
        }
        const legacy = raw as Partial<LegacyCardSchedule>;
        const rating = isRating(legacy.lastRating) ? legacy.lastRating : 'good';
        const rated = adapter.rate(null, rating, nowMs);
        schedules.push({
          cardId,
          ...rated.card,
          dueAt: nowMs,
          minReviewStep: safeNonNegativeInteger(currentStep),
          lastRating: rating,
          algorithm: 'fsrs-6',
        });
      }

      const counts = { ...EMPTY_RATING_COUNTS };
      for (const log of logs) counts[log.rating] += 1;
      const studyStep = Math.max(
        safeNonNegativeInteger(currentStep),
        logs.reduce((max, log) => Math.max(max, safeNonNegativeInteger(log.stepAfter)), 0),
      );
      await dbi.schedules.clear();
      if (schedules.length > 0) await dbi.schedules.bulkPut(schedules);
      const metaWrites: PromiseLike<unknown>[] = [
        setMeta(dbi, META_KEYS.studyStep, studyStep),
        setMeta(dbi, META_KEYS.ratingCounts, counts),
        setMeta(dbi, META_KEYS.lastUndo, null),
        // 로그에는 당시 카드가 due 큐에서 선택됐는지 기록되지 않으므로 안전하게 초기화한다.
        setMeta(dbi, META_KEYS.reviewStreak, 0),
      ];
      if (options.finishMigration) {
        metaWrites.push(
          setMeta(dbi, META_KEYS.fsrsMigrationPending, false),
          setMeta(dbi, META_KEYS.studySession, null),
        );
      }
      await Promise.all(metaWrites);
      return { studyStep, schedules };
    },
  );
}

export function isFsrsSchedule(value: unknown): value is CardSchedule {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<CardSchedule>;
  return (
    typeof s.cardId === 'string' &&
    s.algorithm === 'fsrs-6' &&
    isValidTimestamp(s.dueAt) &&
    isFiniteNonNegative(s.stability) &&
    s.stability <= MAXIMUM_INTERVAL_DAYS &&
    isFiniteNonNegative(s.difficulty) &&
    s.difficulty <= 10 &&
    isNonNegativeInteger(s.elapsedDays) &&
    isNonNegativeInteger(s.scheduledDays) &&
    s.scheduledDays <= MAXIMUM_INTERVAL_DAYS &&
    isNonNegativeInteger(s.learningSteps) &&
    isNonNegativeInteger(s.reps) &&
    isNonNegativeInteger(s.lapses) &&
    (isValidTimestamp(s.lastReviewAt) ||
      (s.lastReviewAt === null && s.state === 'new' && s.reps === 0)) &&
    isNonNegativeInteger(s.minReviewStep) &&
    typeof s.state === 'string' &&
    ['new', 'learning', 'review', 'relearning'].includes(s.state) &&
    (s.lastRating === null || isRating(s.lastRating))
  );
}

function compareLogs(a: ReviewLog, b: ReviewLog): number {
  return (
    reviewTimestamp(a) - reviewTimestamp(b) ||
    safeNonNegativeInteger(a.stepAfter) - safeNonNegativeInteger(b.stepAfter) ||
    a.id.localeCompare(b.id)
  );
}

function reviewTimestamp(log: ReviewLog): number {
  const parsed = Date.parse(log.reviewedAt);
  return Number.isFinite(parsed) ? parsed : safeNonNegativeInteger(log.stepAfter);
}

function normalizeSettings(settings: Settings): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    desiredRetention: clampDesiredRetention(settings?.desiredRetention),
  };
}

function safeNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;
}

function safeTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : fallback;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNonNegative(value) && Number.isInteger(value);
}

function isValidTimestamp(value: unknown): value is number {
  return isFiniteNonNegative(value) && value <= MAX_SAFE_TIMESTAMP_MS;
}

function isRating(value: unknown): value is Rating {
  return value === 'again' || value === 'hard' || value === 'good' || value === 'easy';
}

function getCardId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const cardId = (value as { cardId?: unknown }).cardId;
  return typeof cardId === 'string' ? cardId : null;
}

// Structural assertion: CardSchedule contains every field the FSRS adapter needs.
const _storedShapeCheck: StoredFsrsCard | null = null as CardSchedule | null;
void _storedShapeCheck;
