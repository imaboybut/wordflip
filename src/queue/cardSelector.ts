import { createFsrsAdapter, type FsrsAdapter } from '../scheduler/fsrsAdapter';
import type { CardSchedule } from '../types';
import type { SelectionResult, SelectorContext } from './queueTypes';
import {
  REVIEWS_BEFORE_FORCED_NEW,
  normalizeReviewStreak,
} from '../scheduler/reviewPolicy';

const adapterCache = new Map<number, FsrsAdapter>();

/**
 * FSRS 예정 시각을 지키며 다음 카드를 고르는 순수 함수.
 *
 * - dueAt 시간 바닥과 minReviewStep 간격을 모두 지킨다.
 * - 학습/재학습 카드를 먼저, 일반 복습 카드는 낮은 회상 가능성 순으로 고른다.
 * - 연속 복습 2장 뒤에는 신규가 남아 있으면 한 장을 강제로 섞는다.
 * - 그 외에는 예정 카드가 없을 때 신규 카드를 고른다.
 * - 둘 다 없으면 미래 카드를 억지로 꺼내지 않고 다음 예정 시각만 돌려준다.
 */
export function selectNextCard(ctx: SelectorContext): SelectionResult {
  const {
    nowMs,
    studyStep,
    reviewStreak,
    schedules,
    deckIds,
    newIds,
    recentIds,
    avoidRecentCount,
    currentCardId,
    desiredRetention,
  } = ctx;

  if (deckIds.length === 0) return emptyResult(null);

  const deckSet = new Set(deckIds);
  const avoid = createAvoidSet(
    recentIds,
    avoidRecentCount,
    currentCardId,
  );
  const adapter = getAdapter(desiredRetention);

  const dueCandidates = createCandidateGroup();
  const stepGatedCandidates = createCandidateGroup();
  let nextDueAt: number | null = null;
  let nextReviewStep: number | null = null;

  for (const schedule of schedules.values()) {
    if (!deckSet.has(schedule.cardId) || !Number.isFinite(schedule.dueAt)) {
      continue;
    }

    if (schedule.dueAt > nowMs) {
      nextDueAt =
        nextDueAt === null
          ? schedule.dueAt
          : Math.min(nextDueAt, schedule.dueAt);
      continue;
    }

    if (schedule.minReviewStep > studyStep) {
      nextReviewStep =
        nextReviewStep === null
          ? schedule.minReviewStep
          : Math.min(nextReviewStep, schedule.minReviewStep);
      considerDueCandidate(
        stepGatedCandidates,
        schedule,
        avoid.has(schedule.cardId),
        adapter,
        nowMs,
      );
      continue;
    }

    considerDueCandidate(
      dueCandidates,
      schedule,
      avoid.has(schedule.cardId),
      adapter,
      nowMs,
    );
  }

  const newPick = selectNewCard(newIds, deckSet, avoid, currentCardId);

  // 복습 backlog가 신규를 영원히 가리지 않도록 due 복습 두 장 뒤에는 신규
  // 한 장을 먼저 제시한다. 현재 모드에 신규가 없으면 due 처리를 계속한다.
  if (
    newPick !== null &&
    normalizeReviewStreak(reviewStreak) >= REVIEWS_BEFORE_FORCED_NEW
  ) {
    return {
      cardId: newPick,
      isDueReview: false,
      isNew: true,
      nextDueAt: null,
      nextReviewStep: null,
    };
  }

  // 최근/현재 카드는 대안이 있을 때 피한다. 학습/재학습의 우선순위는
  // 유지하되, 그 묶음이 전부 회피 대상이면 일반 복습의 새 카드를 택한다.
  const duePick = pickDueCandidate(dueCandidates);
  if (duePick !== null) {
    return {
      cardId: duePick,
      isDueReview: true,
      isNew: false,
      nextDueAt: null,
      nextReviewStep: null,
    };
  }

  if (newPick !== null) {
    return {
      cardId: newPick,
      isDueReview: false,
      isNew: true,
      nextDueAt: null,
      nextReviewStep: null,
    };
  }

  // 한 장짜리/별표 덱처럼 대안이 전혀 없으면 step gate만 완화한다.
  // dueAt 시간 바닥은 이미 지났으므로 30분/2시간 전 반복은 생기지 않는다.
  const gatedPick = pickDueCandidate(stepGatedCandidates);
  if (gatedPick !== null) {
    return {
      cardId: gatedPick,
      isDueReview: true,
      isNew: false,
      nextDueAt: null,
      nextReviewStep: null,
    };
  }

  return emptyResult(nextDueAt, nextReviewStep);
}

interface RankedReview {
  schedule: CardSchedule;
  retrievability: number;
}

interface DueCandidateGroup {
  learning: CardSchedule | null;
  learningUnavoided: CardSchedule | null;
  review: RankedReview | null;
  reviewUnavoided: RankedReview | null;
}

function createCandidateGroup(): DueCandidateGroup {
  return {
    learning: null,
    learningUnavoided: null,
    review: null,
    reviewUnavoided: null,
  };
}

function considerDueCandidate(
  group: DueCandidateGroup,
  schedule: CardSchedule,
  isAvoided: boolean,
  adapter: FsrsAdapter,
  nowMs: number,
): void {
  if (isLearningState(schedule)) {
    if (
      group.learning === null ||
      compareScheduleTieBreakers(schedule, group.learning) < 0
    ) {
      group.learning = schedule;
    }
    if (
      !isAvoided &&
      (group.learningUnavoided === null ||
        compareScheduleTieBreakers(schedule, group.learningUnavoided) < 0)
    ) {
      group.learningUnavoided = schedule;
    }
    return;
  }

  const ranked: RankedReview = {
    schedule,
    retrievability: adapter.retrievability(schedule, nowMs),
  };
  if (group.review === null || compareRankedReview(ranked, group.review) < 0) {
    group.review = ranked;
  }
  if (
    !isAvoided &&
    (group.reviewUnavoided === null ||
      compareRankedReview(ranked, group.reviewUnavoided) < 0)
  ) {
    group.reviewUnavoided = ranked;
  }
}

function pickDueCandidate(group: DueCandidateGroup): string | null {
  return (
    group.learningUnavoided?.cardId ??
    group.reviewUnavoided?.schedule.cardId ??
    group.learning?.cardId ??
    group.review?.schedule.cardId ??
    null
  );
}

function getAdapter(desiredRetention: number): FsrsAdapter {
  const key = Number.isFinite(desiredRetention) ? desiredRetention : 0.9;
  const cached = adapterCache.get(key);
  if (cached !== undefined) return cached;
  const adapter = createFsrsAdapter(key, { enableFuzz: false });
  adapterCache.set(key, adapter);
  return adapter;
}

function createAvoidSet(
  recentIds: readonly string[],
  avoidRecentCount: number,
  currentCardId: string | null,
): Set<string> {
  const count = Number.isFinite(avoidRecentCount)
    ? Math.max(0, Math.trunc(avoidRecentCount))
    : 0;
  const avoid = new Set(count > 0 ? recentIds.slice(-count) : []);
  if (currentCardId !== null) avoid.add(currentCardId);
  return avoid;
}

function isLearningState(schedule: CardSchedule): boolean {
  return schedule.state === 'learning' || schedule.state === 'relearning';
}

function compareRankedReview(a: RankedReview, b: RankedReview): number {
  const retrievabilityDifference = a.retrievability - b.retrievability;
  return retrievabilityDifference !== 0
    ? retrievabilityDifference
    : compareScheduleTieBreakers(a.schedule, b.schedule);
}

function compareScheduleTieBreakers(
  a: CardSchedule,
  b: CardSchedule,
): number {
  if (a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
  const aLastReview = a.lastReviewAt ?? Number.NEGATIVE_INFINITY;
  const bLastReview = b.lastReviewAt ?? Number.NEGATIVE_INFINITY;
  if (aLastReview !== bLastReview) return aLastReview - bLastReview;
  return compareCardIds(a.cardId, b.cardId);
}

function compareCardIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function selectNewCard(
  newIds: readonly string[],
  deckSet: ReadonlySet<string>,
  avoid: ReadonlySet<string>,
  currentCardId: string | null,
): string | null {
  let firstInDeck: string | null = null;
  let firstNotCurrent: string | null = null;
  for (const id of newIds) {
    if (!deckSet.has(id)) continue;
    firstInDeck ??= id;
    if (id !== currentCardId) firstNotCurrent ??= id;
    if (!avoid.has(id)) return id;
  }
  return firstNotCurrent ?? firstInDeck;
}

function emptyResult(
  nextDueAt: number | null,
  nextReviewStep: number | null = null,
): SelectionResult {
  return {
    cardId: null,
    isDueReview: false,
    isNew: false,
    nextDueAt,
    nextReviewStep,
  };
}

/** 전체 둘러보기 모드: due 여부와 무관하게 순서대로 순환 */
export function selectBrowseCard(
  orderedIds: readonly string[],
  browseIndex: number,
): { cardId: string | null; nextIndex: number } {
  if (orderedIds.length === 0) return { cardId: null, nextIndex: 0 };
  const idx =
    ((browseIndex % orderedIds.length) + orderedIds.length) %
    orderedIds.length;
  return { cardId: orderedIds[idx], nextIndex: idx };
}

/** 시드 기반 결정적 셔플 (무작위 신규 카드 순서가 재시작 후에도 유지되도록) */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const arr = items.slice();
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
