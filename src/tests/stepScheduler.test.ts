import { describe, expect, it } from 'vitest';
import { rateCard } from '../scheduler/stepScheduler';
import {
  INITIAL_EASE,
  MAX_EASE,
  MAX_INTERVAL,
  MIN_EASE,
} from '../scheduler/schedulerTypes';
import { isValidInterval } from '../scheduler/schedulerValidation';
import { makeSchedule } from './helpers';
import type { Rating } from '../types';

describe('신규 카드 기본 간격', () => {
  const cases: [Rating, number][] = [
    ['again', 3],
    ['hard', 12],
    ['good', 800],
    ['easy', 2400],
  ];

  it.each(cases)('신규 %s → %i step 뒤', (rating, expected) => {
    const result = rateCard(null, 'c1', rating, 10);
    expect(result.intervalSteps).toBe(expected);
    expect(result.dueStep).toBe(10 + expected);
    expect(result.ease).toBe(INITIAL_EASE);
    expect(result.repetitions).toBe(1);
    expect(result.lapses).toBe(rating === 'again' ? 1 : 0);
    expect(result.firstSeenStep).toBe(10);
    expect(result.lastReviewedStep).toBe(10);
    expect(result.lastRating).toBe(rating);
  });
});

describe('기존 카드 간격 갱신', () => {
  it('Again은 이전 간격과 무관하게 3 step 뒤로 보낸다', () => {
    const prev = makeSchedule({ cardId: 'c1', intervalSteps: 100, ease: 2.3 });
    const result = rateCard(prev, 'c1', 'again', 50);
    expect(result.intervalSteps).toBe(3);
    expect(result.lapses).toBe(prev.lapses + 1);
    expect(result.ease).toBeCloseTo(2.1);

    const small = makeSchedule({ cardId: 'c1', intervalSteps: 4 });
    expect(rateCard(small, 'c1', 'again', 50).intervalSteps).toBe(3);
  });

  it('Hard는 완만하게 증가한다 (I * 1.2, 최소 12)', () => {
    const prev = makeSchedule({ cardId: 'c1', intervalSteps: 100, ease: 2.3 });
    const result = rateCard(prev, 'c1', 'hard', 50);
    expect(result.intervalSteps).toBe(120);
    expect(result.ease).toBeCloseTo(2.25);
    expect(result.lapses).toBe(prev.lapses);
  });

  it('Good은 최소 800 step 뒤이며, 더 큰 기존 간격에는 ease 배율을 적용한다', () => {
    const prev = makeSchedule({ cardId: 'c1', intervalSteps: 100, ease: 2.3 });
    const result = rateCard(prev, 'c1', 'good', 50);
    expect(result.intervalSteps).toBe(800);
    expect(result.ease).toBe(2.3);

    const mature = makeSchedule({ cardId: 'c1', intervalSteps: 1000, ease: 2.3 });
    expect(rateCard(mature, 'c1', 'good', 50).intervalSteps).toBe(2300);
  });

  it('직전까지 모르던 카드는 누적 오답에 따라 짧게 재확인한 뒤 졸업한다', () => {
    const onceMissed = makeSchedule({
      cardId: 'c1',
      intervalSteps: 3,
      lapses: 1,
      lastRating: 'again',
    });
    const firstGood = rateCard(onceMissed, 'c1', 'good', 50);
    expect(firstGood.intervalSteps).toBe(200);

    const oftenMissed = makeSchedule({
      cardId: 'c1',
      intervalSteps: 3,
      lapses: 8,
      lastRating: 'again',
    });
    expect(rateCard(oftenMissed, 'c1', 'good', 50).intervalSteps).toBe(40);

    // 같은 카드를 연속으로 한 번 더 맞히면 일반 장기 간격으로 이동한다.
    expect(rateCard(firstGood, 'c1', 'good', 51).intervalSteps).toBe(800);
  });

  it('Easy는 최소 2400 step 뒤이며 큰 간격에는 I * ease * 1.6을 적용한다', () => {
    const prev = makeSchedule({ cardId: 'c1', intervalSteps: 100, ease: 2.3 });
    const result = rateCard(prev, 'c1', 'easy', 50);
    expect(result.intervalSteps).toBe(2400);
    expect(result.ease).toBeCloseTo(2.45);

    const mature = makeSchedule({ cardId: 'c1', intervalSteps: 1000, ease: 2.3 });
    expect(rateCard(mature, 'c1', 'easy', 50).intervalSteps).toBe(3680);
  });

  it('같은 간격에서 Again < Hard < Good < Easy 순으로 커진다', () => {
    const prev = makeSchedule({ cardId: 'c1', intervalSteps: 200, ease: 2.0 });
    const again = rateCard(prev, 'c1', 'again', 50).intervalSteps;
    const hard = rateCard(prev, 'c1', 'hard', 50).intervalSteps;
    const good = rateCard(prev, 'c1', 'good', 50).intervalSteps;
    const easy = rateCard(prev, 'c1', 'easy', 50).intervalSteps;
    expect(again).toBeLessThan(hard);
    expect(hard).toBeLessThan(good);
    expect(good).toBeLessThan(easy);
  });
});

describe('clamp', () => {
  it('ease는 최소 1.30 아래로 내려가지 않는다', () => {
    const prev = makeSchedule({ cardId: 'c1', intervalSteps: 40, ease: 1.31 });
    expect(rateCard(prev, 'c1', 'again', 50).ease).toBe(MIN_EASE);
  });

  it('ease는 최대 3.20 위로 올라가지 않는다', () => {
    const prev = makeSchedule({ cardId: 'c1', intervalSteps: 40, ease: 3.15 });
    expect(rateCard(prev, 'c1', 'easy', 50).ease).toBe(MAX_EASE);
  });

  it('간격은 20000을 넘지 않는다', () => {
    const prev = makeSchedule({ cardId: 'c1', intervalSteps: 19000, ease: 3.2 });
    expect(rateCard(prev, 'c1', 'easy', 50).intervalSteps).toBe(MAX_INTERVAL);
  });

  it('간격은 3 아래로 내려가지 않는다', () => {
    const prev = makeSchedule({ cardId: 'c1', intervalSteps: 3, ease: 1.3 });
    expect(rateCard(prev, 'c1', 'again', 50).intervalSteps).toBe(3);
  });
});

describe('손상 상태 fallback (Again 3 / Hard 12 / Good 800 / Easy 2400)', () => {
  const corrupt = [
    ['NaN interval', makeSchedule({ cardId: 'c1', intervalSteps: NaN })],
    ['Infinity interval', makeSchedule({ cardId: 'c1', intervalSteps: Infinity })],
    ['음수 interval', makeSchedule({ cardId: 'c1', intervalSteps: -10 })],
    ['소수 interval', makeSchedule({ cardId: 'c1', intervalSteps: 40.5 })],
    ['NaN ease', makeSchedule({ cardId: 'c1', ease: NaN })],
    ['음수 ease', makeSchedule({ cardId: 'c1', ease: -2 })],
  ] as const;

  it.each(corrupt)('%s → 안전 기본값 사용', (_label, prev) => {
    expect(rateCard(prev, 'c1', 'again', 50).intervalSteps).toBe(3);
    expect(rateCard(prev, 'c1', 'hard', 50).intervalSteps).toBe(12);
    expect(rateCard(prev, 'c1', 'good', 50).intervalSteps).toBe(800);
    expect(rateCard(prev, 'c1', 'easy', 50).intervalSteps).toBe(2400);
    expect(rateCard(prev, 'c1', 'good', 50).ease).toBe(INITIAL_EASE);
  });
});

describe('결과 불변식', () => {
  it('결과 간격은 항상 양의 유한 정수', () => {
    const ratings: Rating[] = ['again', 'hard', 'good', 'easy'];
    let prev = rateCard(null, 'c1', 'good', 1);
    let step = 1;
    // 여러 번 반복해도 항상 유효한 정수 간격
    for (let i = 0; i < 200; i++) {
      const rating = ratings[i % 4];
      step += 1;
      prev = rateCard(prev, 'c1', rating, step);
      expect(isValidInterval(prev.intervalSteps)).toBe(true);
      expect(Number.isFinite(prev.intervalSteps)).toBe(true);
      expect(Number.isInteger(prev.intervalSteps)).toBe(true);
      expect(prev.intervalSteps).toBeGreaterThanOrEqual(3);
      expect(prev.intervalSteps).toBeLessThanOrEqual(20000);
      expect(prev.dueStep).toBe(step + prev.intervalSteps);
    }
  });

  it('소수 계산 결과는 정수로 반올림된다', () => {
    const prev = makeSchedule({ cardId: 'c1', intervalSteps: 401, ease: 2.31 });
    const result = rateCard(prev, 'c1', 'good', 50);
    expect(Number.isInteger(result.intervalSteps)).toBe(true);
    expect(result.intervalSteps).toBe(Math.round(401 * 2.31));
  });

  it('날짜가 아니라 step만 사용한다 — 같은 입력이면 언제 계산해도 같은 결과', () => {
    const prev = makeSchedule({ cardId: 'c1', intervalSteps: 100, ease: 2.0 });
    const r1 = rateCard(prev, 'c1', 'good', 50);
    // 시스템 시간이 바뀌어도 (다음 날이 되어도) 결과는 동일해야 한다
    const r2 = rateCard(prev, 'c1', 'good', 50);
    expect(r1).toEqual(r2);
    expect(r1.dueStep).toBe(50 + r1.intervalSteps);
  });
});
