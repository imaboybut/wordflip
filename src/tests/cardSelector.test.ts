import { describe, expect, it } from 'vitest';
import { selectBrowseCard, selectNextCard } from '../queue/cardSelector';
import type { SelectorContext } from '../queue/queueTypes';
import type { CardSchedule } from '../types';
import { makeSchedule } from './helpers';

function ctx(overrides: Partial<SelectorContext>): SelectorContext {
  return {
    studyStep: 0,
    schedules: new Map<string, CardSchedule>(),
    deckIds: [],
    newIds: [],
    recentIds: [],
    avoidRecentCount: 5,
    reviewStreak: 0,
    currentCardId: null,
    ...overrides,
  };
}

function scheduleMap(list: CardSchedule[]): Map<string, CardSchedule> {
  return new Map(list.map((s) => [s.cardId, s]));
}

describe('큐 선택 규칙', () => {
  it('due 카드를 신규 카드보다 우선한다', () => {
    const schedules = scheduleMap([
      makeSchedule({ cardId: 'due1', dueStep: 5, lastReviewedStep: 1 }),
    ]);
    const result = selectNextCard(
      ctx({
        studyStep: 10,
        schedules,
        deckIds: ['due1', 'new1', 'new2'],
        newIds: ['new1', 'new2'],
      }),
    );
    expect(result.cardId).toBe('due1');
    expect(result.isDueReview).toBe(true);
  });

  it('due 카드 여러 개면 dueStep 작은 순 → lastReviewedStep 작은 순', () => {
    const schedules = scheduleMap([
      makeSchedule({ cardId: 'a', dueStep: 8, lastReviewedStep: 3 }),
      makeSchedule({ cardId: 'b', dueStep: 5, lastReviewedStep: 4 }),
      makeSchedule({ cardId: 'c', dueStep: 5, lastReviewedStep: 2 }),
    ]);
    const result = selectNextCard(
      ctx({ studyStep: 10, schedules, deckIds: ['a', 'b', 'c'] }),
    );
    expect(result.cardId).toBe('c');
  });

  it('복습 카드 3연속 후에는 신규 카드 1장을 보여준다', () => {
    const schedules = scheduleMap([
      makeSchedule({ cardId: 'due1', dueStep: 1 }),
    ]);
    const result = selectNextCard(
      ctx({
        studyStep: 10,
        schedules,
        deckIds: ['due1', 'new1'],
        newIds: ['new1'],
        reviewStreak: 3,
      }),
    );
    expect(result.cardId).toBe('new1');
    expect(result.isNew).toBe(true);
    expect(result.isDueReview).toBe(false);
  });

  it('streak이 3 미만이면 계속 due 우선', () => {
    const schedules = scheduleMap([makeSchedule({ cardId: 'due1', dueStep: 1 })]);
    const result = selectNextCard(
      ctx({
        studyStep: 10,
        schedules,
        deckIds: ['due1', 'new1'],
        newIds: ['new1'],
        reviewStreak: 2,
        recentIds: [],
      }),
    );
    expect(result.cardId).toBe('due1');
  });

  it('최근 5장에 나온 카드는 다시 선택하지 않는다', () => {
    const schedules = scheduleMap([
      makeSchedule({ cardId: 'r1', dueStep: 1, lastReviewedStep: 1 }),
      makeSchedule({ cardId: 'r2', dueStep: 2, lastReviewedStep: 2 }),
    ]);
    const result = selectNextCard(
      ctx({
        studyStep: 10,
        schedules,
        deckIds: ['r1', 'r2'],
        recentIds: ['x1', 'x2', 'x3', 'x4', 'r1'],
      }),
    );
    expect(result.cardId).toBe('r2');
  });

  it('대안이 없을 때만 최근 카드를 허용한다', () => {
    const schedules = scheduleMap([
      makeSchedule({ cardId: 'r1', dueStep: 1 }),
    ]);
    const result = selectNextCard(
      ctx({
        studyStep: 10,
        schedules,
        deckIds: ['r1'],
        recentIds: ['r1'],
      }),
    );
    expect(result.cardId).toBe('r1');
  });

  it('신규 카드가 모두 소진되면 가장 오래 보지 않은 카드를 고른다', () => {
    const schedules = scheduleMap([
      makeSchedule({ cardId: 'a', dueStep: 100, lastReviewedStep: 9 }),
      makeSchedule({ cardId: 'b', dueStep: 200, lastReviewedStep: 3 }),
      makeSchedule({ cardId: 'c', dueStep: 300, lastReviewedStep: 6 }),
    ]);
    const result = selectNextCard(
      ctx({
        studyStep: 10,
        schedules,
        deckIds: ['a', 'b', 'c'],
        newIds: [],
        avoidRecentCount: 0,
      }),
    );
    expect(result.cardId).toBe('b');
  });

  it('신규 카드를 순서대로 모두 탐색할 수 있다', () => {
    const seen = new Set<string>();
    const deckIds = Array.from({ length: 10 }, (_, i) => `n${i}`);
    let newIds = deckIds.slice();
    let current: string | null = null;
    for (let i = 0; i < 10; i++) {
      const result = selectNextCard(
        ctx({ deckIds, newIds, currentCardId: current }),
      );
      expect(result.cardId).not.toBeNull();
      expect(result.isNew).toBe(true);
      seen.add(result.cardId as string);
      current = result.cardId;
      newIds = newIds.filter((id) => id !== result.cardId);
    }
    expect(seen.size).toBe(10);
  });

  it('카드가 한 장뿐이면 무한 루프 없이 그 카드를 반환한다', () => {
    const schedules = scheduleMap([
      makeSchedule({ cardId: 'only', dueStep: 1, lastReviewedStep: 1 }),
    ]);
    const result = selectNextCard(
      ctx({
        studyStep: 10,
        schedules,
        deckIds: ['only'],
        recentIds: ['only'],
        currentCardId: 'only',
      }),
    );
    expect(result.cardId).toBe('only');
  });

  it('같은 카드가 즉시 연속으로 나오지 않는다 (대안이 있을 때)', () => {
    const schedules = scheduleMap([
      makeSchedule({ cardId: 'a', dueStep: 1, lastReviewedStep: 1 }),
      makeSchedule({ cardId: 'b', dueStep: 2, lastReviewedStep: 2 }),
    ]);
    const result = selectNextCard(
      ctx({
        studyStep: 10,
        schedules,
        deckIds: ['a', 'b'],
        currentCardId: 'a',
        avoidRecentCount: 0,
      }),
    );
    expect(result.cardId).toBe('b');
  });

  it('deck에 속하지 않은 카드(별표/검색 밖)는 due여도 나오지 않는다', () => {
    const schedules = scheduleMap([
      makeSchedule({ cardId: 'out', dueStep: 1 }),
      makeSchedule({ cardId: 'in', dueStep: 5 }),
    ]);
    const result = selectNextCard(
      ctx({ studyStep: 10, schedules, deckIds: ['in'] }),
    );
    expect(result.cardId).toBe('in');
  });

  it('빈 덱이면 null을 반환한다 (별표 없음 등)', () => {
    const result = selectNextCard(ctx({ deckIds: [] }));
    expect(result.cardId).toBeNull();
  });

  it('5,000개 카드에서도 선택이 빠르다', () => {
    const n = 5000;
    const deckIds = Array.from({ length: n }, (_, i) => `c${i}`);
    const schedules = scheduleMap(
      deckIds.slice(0, 4000).map((id, i) =>
        makeSchedule({
          cardId: id,
          dueStep: (i * 7) % 3000,
          lastReviewedStep: i,
        }),
      ),
    );
    const newIds = deckIds.slice(4000);
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      selectNextCard(
        ctx({
          studyStep: 1500 + i,
          schedules,
          deckIds,
          newIds,
          recentIds: deckIds.slice(i, i + 5),
        }),
      );
    }
    const elapsed = performance.now() - start;
    // 100회 선택에 1초 미만 (실사용에선 1회당 수 ms 수준)
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('전체 둘러보기', () => {
  it('due 여부와 무관하게 순서대로 순환한다', () => {
    const ids = ['a', 'b', 'c'];
    expect(selectBrowseCard(ids, 0).cardId).toBe('a');
    expect(selectBrowseCard(ids, 2).cardId).toBe('c');
    // 끝까지 도달하면 처음부터 순환
    expect(selectBrowseCard(ids, 3).cardId).toBe('a');
    expect(selectBrowseCard(ids, 7).cardId).toBe('b');
  });

  it('빈 목록이면 null', () => {
    expect(selectBrowseCard([], 0).cardId).toBeNull();
  });
});
