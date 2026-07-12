import type { CardSchedule } from '../types';
import type { SelectionResult, SelectorContext } from './queueTypes';

/**
 * 다음 카드를 고르는 순수 함수. 규칙:
 * 1. dueStep <= studyStep 인 복습 예정 카드 우선
 * 2. 단, 복습 카드가 연속 3장 나왔으면 다음 한 장은 신규 카드
 * 3. 신규 카드 소진 시 예정 카드 또는 가장 오래 보지 않은 카드
 * 4. 최근 N장(기본 5)에 나온 카드는 가능하면 제외, 대안이 없을 때만 허용
 * 5. 같은 카드의 즉시 연속 등장 금지 (카드가 한 장뿐인 경우 제외)
 * 6. due 카드가 여럿이면 dueStep 오름차순, 같으면 lastReviewedStep 오름차순
 */
export function selectNextCard(ctx: SelectorContext): SelectionResult {
  const {
    studyStep,
    schedules,
    deckIds,
    newIds,
    recentIds,
    avoidRecentCount,
    reviewStreak,
    currentCardId,
  } = ctx;

  if (deckIds.length === 0) return { cardId: null, isDueReview: false, isNew: false };

  const deckSet = new Set(deckIds);
  const avoid = new Set<string>(
    avoidRecentCount > 0 ? recentIds.slice(-avoidRecentCount) : [],
  );
  if (currentCardId !== null) avoid.add(currentCardId);

  const dueCards = collectDue(schedules, deckSet, studyStep);
  const freshNew = newIds.filter((id) => !avoid.has(id));

  // 규칙 2: 복습 3연속 후에는 신규 카드 한 장
  if (dueCards.length > 0 && reviewStreak >= 3 && freshNew.length > 0) {
    return { cardId: freshNew[0], isDueReview: false, isNew: true };
  }

  // 규칙 1: due 카드 우선 (최근 반복 회피)
  if (dueCards.length > 0) {
    const pick =
      dueCards.find((s) => !avoid.has(s.cardId)) ??
      // 대안이 전혀 없으면 최근 카드 허용하되 즉시 연속만은 회피
      dueCards.find((s) => s.cardId !== currentCardId);
    if (pick) return { cardId: pick.cardId, isDueReview: true, isNew: false };
    // due 카드가 현재 카드 하나뿐인 경우 → 아래 일반 규칙으로 진행
  }

  // 신규 카드
  if (freshNew.length > 0) {
    return { cardId: freshNew[0], isDueReview: false, isNew: true };
  }
  const anyNew = newIds.find((id) => id !== currentCardId);
  if (anyNew !== undefined) {
    return { cardId: anyNew, isDueReview: false, isNew: true };
  }

  // 신규도 due도 없음 → 가장 오래 보지 않은 카드
  const seen = deckIds
    .filter((id) => schedules.has(id))
    .sort((a, b) => {
      const la = schedules.get(a)?.lastReviewedStep ?? -1;
      const lb = schedules.get(b)?.lastReviewedStep ?? -1;
      return la - lb;
    });
  const pick =
    seen.find((id) => !avoid.has(id)) ??
    seen.find((id) => id !== currentCardId) ??
    // 카드가 한 장뿐이면 그 카드라도 보여준다 (무한 루프 방지)
    seen[0] ??
    deckIds[0];

  const stillDue = isDue(schedules.get(pick), studyStep);
  return { cardId: pick, isDueReview: stillDue, isNew: !schedules.has(pick) };
}

function isDue(s: CardSchedule | undefined, studyStep: number): boolean {
  return s !== undefined && s.dueStep <= studyStep;
}

function collectDue(
  schedules: ReadonlyMap<string, CardSchedule>,
  deckSet: ReadonlySet<string>,
  studyStep: number,
): CardSchedule[] {
  const due: CardSchedule[] = [];
  for (const s of schedules.values()) {
    if (s.dueStep <= studyStep && deckSet.has(s.cardId)) due.push(s);
  }
  // 규칙 6: dueStep 오름차순 → lastReviewedStep 오름차순 → id (안정성)
  due.sort((a, b) => {
    if (a.dueStep !== b.dueStep) return a.dueStep - b.dueStep;
    const la = a.lastReviewedStep ?? -1;
    const lb = b.lastReviewedStep ?? -1;
    if (la !== lb) return la - lb;
    return a.cardId < b.cardId ? -1 : 1;
  });
  return due;
}

/** 전체 둘러보기 모드: due 여부와 무관하게 순서대로 순환 */
export function selectBrowseCard(
  orderedIds: readonly string[],
  browseIndex: number,
): { cardId: string | null; nextIndex: number } {
  if (orderedIds.length === 0) return { cardId: null, nextIndex: 0 };
  const idx = ((browseIndex % orderedIds.length) + orderedIds.length) % orderedIds.length;
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
