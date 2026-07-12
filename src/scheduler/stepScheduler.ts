import type { CardSchedule, Rating } from '../types';
import {
  EASY_MIN_INTERVAL,
  INITIAL_EASE,
  KNOWN_MIN_INTERVAL,
  MAX_EASE,
  MIN_EASE,
  NEW_CARD_INTERVALS,
  RELEARNING_GOOD_BASE_INTERVAL,
  RELEARNING_GOOD_MIN_INTERVAL,
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
      lapses: rating === 'again' ? 1 : 0,
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
      // "모른다"는 과거 간격이 아무리 길어도 곧 다시 확인한다.
      interval = 3;
      lapses += 1;
      ease = Math.max(MIN_EASE, ease - 0.2);
      break;
    case 'hard':
      interval = Math.max(12, Math.round(I * 1.2));
      ease = Math.max(MIN_EASE, ease - 0.05);
      break;
    case 'good':
      if (prev.lastRating === 'again') {
        // 방금 전까지 모르던 카드는 Good 한 번으로 완전히 졸업시키지 않는다.
        // 누적 오답이 많을수록 한 차례 더 빠르게 확인하고, 연속 Good이면
        // 다음 평가부터 일반 장기 간격(최소 800)으로 넘어간다.
        const lapseDivisor = Math.min(Math.max(lapses, 1), 5);
        interval = Math.max(
          RELEARNING_GOOD_MIN_INTERVAL,
          Math.round(RELEARNING_GOOD_BASE_INTERVAL / lapseDivisor),
        );
      } else {
        interval = Math.max(KNOWN_MIN_INTERVAL, Math.round(I * ease));
      }
      break;
    case 'easy':
      interval = Math.max(EASY_MIN_INTERVAL, Math.round(I * ease * 1.6));
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

/**
 * schedulerVersion이 없던 기존 로그를 복구하기 위한 최초 배포 공식.
 * 새 학습에는 사용하지 않으며, 과거 로그를 새 정책으로 재해석하지 않게 한다.
 */
export function rateCardLegacyV1(
  prev: CardSchedule | null,
  cardId: string,
  rating: Rating,
  stepAfter: number,
): CardSchedule {
  const intervals: Record<Rating, number> = {
    again: 3,
    hard: 12,
    good: 40,
    easy: 120,
  };

  if (prev === null) {
    const interval = intervals[rating];
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

  if (isCorruptSchedule(prev)) {
    const interval = intervals[rating];
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

  let ease = prev.ease;
  let lapses = prev.lapses;
  let interval: number;
  switch (rating) {
    case 'again':
      interval = Math.max(3, Math.round(prev.intervalSteps * 0.25));
      lapses += 1;
      ease = Math.max(MIN_EASE, ease - 0.2);
      break;
    case 'hard':
      interval = Math.max(12, Math.round(prev.intervalSteps * 1.2));
      ease = Math.max(MIN_EASE, ease - 0.05);
      break;
    case 'good':
      interval = Math.max(40, Math.round(prev.intervalSteps * ease));
      break;
    case 'easy':
      interval = Math.max(120, Math.round(prev.intervalSteps * ease * 1.6));
      ease = Math.min(MAX_EASE, ease + 0.15);
      break;
  }
  interval = clampInterval(interval);

  if (!isValidInterval(interval) || !isValidEase(ease)) {
    interval = intervals[rating];
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
