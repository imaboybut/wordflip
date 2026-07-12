import type { Rating } from '../types';

export const MIN_INTERVAL = 3;
export const MAX_INTERVAL = 20000;
export const MIN_EASE = 1.3;
export const MAX_EASE = 3.2;
export const INITIAL_EASE = 2.3;

/** 처음 평가한 카드의 기본 간격 (step 단위) */
export const NEW_CARD_INTERVALS: Record<Rating, number> = {
  again: 3,
  hard: 12,
  good: 40,
  easy: 120,
};

/**
 * 손상된 상태가 검출됐을 때만 사용하는 안전 기본값.
 * 정상 스케줄 계산 경로와 절대 섞이지 않는다.
 */
export const SAFE_FALLBACK_INTERVALS: Record<Rating, number> = {
  again: 3,
  hard: 12,
  good: 40,
  easy: 120,
};
