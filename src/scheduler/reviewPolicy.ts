import type { Rating } from '../types';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const MAX_SAFE_DATE_TIMESTAMP_MS = 8_640_000_000_000_000;

/** WordFlip의 짧은 세션 정책. FSRS가 더 긴 간격을 계산하면 그대로 유지한다. */
export const MIN_AGAIN_DELAY_MS = 30 * MINUTE_MS;
export const MIN_HARD_DELAY_MS = 2 * HOUR_MS;

/** 평가 횟수 기반 재등장 간격. 양 끝값을 모두 포함한다. */
export const MIN_AGAIN_CARD_GAP = 12;
export const MAX_AGAIN_CARD_GAP = 24;
export const MIN_HARD_CARD_GAP = 30;
export const MAX_HARD_CARD_GAP = 50;

/** 연속 복습 두 장 뒤 신규 한 장을 섞는다. */
export const REVIEWS_BEFORE_FORCED_NEW = 2;

export function enforceMinimumRatingDelay(
  dueAt: number,
  reviewedAt: number,
  rating: Rating,
): number {
  const minimumDelay =
    rating === 'again'
      ? MIN_AGAIN_DELAY_MS
      : rating === 'hard'
        ? MIN_HARD_DELAY_MS
        : 0;
  return Math.min(
    MAX_SAFE_DATE_TIMESTAMP_MS,
    Math.max(dueAt, reviewedAt + minimumDelay),
  );
}

/**
 * uid·카드·시각을 포함한 seed로 범위 안의 간격을 결정한다. 결과를 schedule
 * snapshot에 저장하므로 앱 재시작과 로그 복구 뒤에도 같은 목표 step을 사용한다.
 */
export function ratingCardGap(rating: Rating, seed: string): number {
  if (rating === 'again') {
    return deterministicGap(seed, MIN_AGAIN_CARD_GAP, MAX_AGAIN_CARD_GAP);
  }
  if (rating === 'hard') {
    return deterministicGap(seed, MIN_HARD_CARD_GAP, MAX_HARD_CARD_GAP);
  }
  return 0;
}

export function normalizeReviewStreak(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(REVIEWS_BEFORE_FORCED_NEW, Math.trunc(value));
}

export function nextReviewStreak(
  previous: unknown,
  wasDueReview: boolean,
): number {
  return wasDueReview
    ? Math.min(
        REVIEWS_BEFORE_FORCED_NEW,
        normalizeReviewStreak(previous) + 1,
      )
    : 0;
}

function deterministicGap(seed: string, minimum: number, maximum: number): number {
  let hash = 2_166_136_261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return minimum + ((hash >>> 0) % (maximum - minimum + 1));
}
