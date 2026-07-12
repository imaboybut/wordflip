import type { Rating } from '../types';

export const MIN_INTERVAL = 3;
export const MAX_INTERVAL = 20000;
export const MIN_EASE = 1.3;
export const MAX_EASE = 3.2;
export const INITIAL_EASE = 2.3;

/** 두 버튼 학습 흐름에서 "안다"로 평가한 카드가 다시 나오는 최소 간격. */
export const KNOWN_MIN_INTERVAL = 800;
/** "아주 쉽다" 평가는 Good보다 충분히 뒤에 나오도록 유지한다. */
export const EASY_MIN_INTERVAL = 2400;
/** 직전까지 모르던 카드를 처음 맞힌 뒤 다시 확인하는 기본 간격. */
export const RELEARNING_GOOD_BASE_INTERVAL = 200;
export const RELEARNING_GOOD_MIN_INTERVAL = 40;

/** 처음 평가한 카드의 기본 간격 (step 단위) */
export const NEW_CARD_INTERVALS: Record<Rating, number> = {
  again: 3,
  hard: 12,
  good: KNOWN_MIN_INTERVAL,
  easy: EASY_MIN_INTERVAL,
};

/**
 * 손상된 상태가 검출됐을 때만 사용하는 안전 기본값.
 * 정상 스케줄 계산 경로와 절대 섞이지 않는다.
 */
export const SAFE_FALLBACK_INTERVALS: Record<Rating, number> = {
  again: 3,
  hard: 12,
  good: KNOWN_MIN_INTERVAL,
  easy: EASY_MIN_INTERVAL,
};
