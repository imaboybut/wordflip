import type { CardSchedule } from '../types';
import { MAX_EASE, MAX_INTERVAL, MIN_EASE, MIN_INTERVAL } from './schedulerTypes';

/** 스케줄 결과로 허용되는 간격: 양의 유한 정수, [3, 20000] */
export function isValidInterval(n: unknown): n is number {
  return (
    typeof n === 'number' &&
    Number.isFinite(n) &&
    Number.isInteger(n) &&
    n >= MIN_INTERVAL &&
    n <= MAX_INTERVAL
  );
}

export function isValidEase(n: unknown): n is number {
  return (
    typeof n === 'number' && Number.isFinite(n) && n >= MIN_EASE && n <= MAX_EASE
  );
}

function isNonNegativeInt(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

/**
 * 저장된 스케줄 상태가 손상됐는지 검사한다.
 * 손상된 경우에만 SAFE_FALLBACK_INTERVALS 경로를 사용한다.
 */
export function isCorruptSchedule(s: CardSchedule): boolean {
  return (
    !isValidInterval(s.intervalSteps) ||
    !isValidEase(s.ease) ||
    !isNonNegativeInt(s.dueStep) ||
    !isNonNegativeInt(s.repetitions) ||
    !isNonNegativeInt(s.lapses)
  );
}

export function clampInterval(n: number): number {
  return Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.round(n)));
}

export function clampEase(n: number): number {
  return Math.min(MAX_EASE, Math.max(MIN_EASE, n));
}
