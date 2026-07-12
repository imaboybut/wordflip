import type { CardSchedule, Rating } from '../types';
import {
  INITIAL_EASE,
  MAX_EASE,
  MIN_EASE,
  NEW_CARD_INTERVALS,
  SAFE_FALLBACK_INTERVALS,
} from './schedulerTypes';
import {
  clampInterval,
  isCorruptSchedule,
  isValidEase,
  isValidInterval,
} from './schedulerValidation';

/**
 * 넘김 횟수(step) 기반 순수 스케줄러.
 *
 * 날짜/시각은 절대 사용하지 않는다. 평가할 때마다 전역 studyStep이 1 증가하며,
 * `stepAfter`는 이번 평가가 반영된 직후의 studyStep 값이다.
 * 카드는 `dueStep <= 현재 studyStep`이 되면 다시 등장한다.
 */
export function rateCard(
  prev: CardSchedule | null,
  cardId: string,
  rating: Rating,
  stepAfter: number,
): CardSchedule {
  // 처음 평가하는 카드: 고정 기본 간격
  if (prev === null) {
    const interval = NEW_CARD_INTERVALS[rating];
    return {
      cardId,
      dueStep: stepAfter + interval,
      intervalSteps: interval,
      repetitions: 1,
      lapses: 0,
      ease: INITIAL_EASE,
      lastRating: rating,
      lastReviewedStep: stepAfter,
      firstSeenStep: stepAfter,
    };
  }

  // 손상된 상태 검출 시에만 안전 기본값 사용 (정상 경로와 섞지 않음)
  if (isCorruptSchedule(prev)) {
    const interval = SAFE_FALLBACK_INTERVALS[rating];
    return {
      cardId,
      dueStep: stepAfter + interval,
      intervalSteps: interval,
      repetitions: safeCount(prev.repetitions) + 1,
      lapses: safeCount(prev.lapses) + (rating === 'again' ? 1 : 0),
      ease: INITIAL_EASE,
      lastRating: rating,
      lastReviewedStep: stepAfter,
      firstSeenStep: safeStep(prev.firstSeenStep),
    };
  }

  const I = prev.intervalSteps;
  let ease = prev.ease;
  let lapses = prev.lapses;
  let interval: number;

  switch (rating) {
    case 'again':
      interval = Math.max(3, Math.round(I * 0.25));
      lapses += 1;
      ease = Math.max(MIN_EASE, ease - 0.2);
      break;
    case 'hard':
      interval = Math.max(12, Math.round(I * 1.2));
      ease = Math.max(MIN_EASE, ease - 0.05);
      break;
    case 'good':
      interval = Math.max(40, Math.round(I * ease));
      break;
    case 'easy':
      interval = Math.max(120, Math.round(I * ease * 1.6));
      ease = Math.min(MAX_EASE, ease + 0.15);
      break;
  }

  interval = clampInterval(interval);

  // 마지막 방어선: 계산 결과가 비정상이면 안전 기본값으로 대체
  if (!isValidInterval(interval) || !isValidEase(ease)) {
    interval = SAFE_FALLBACK_INTERVALS[rating];
    ease = INITIAL_EASE;
  }

  return {
    cardId,
    dueStep: stepAfter + interval,
    intervalSteps: interval,
    repetitions: prev.repetitions + 1,
    lapses,
    ease,
    lastRating: rating,
    lastReviewedStep: stepAfter,
    firstSeenStep: prev.firstSeenStep ?? stepAfter,
  };
}

function safeCount(n: unknown): number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0;
}

function safeStep(n: unknown): number | null {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
}
