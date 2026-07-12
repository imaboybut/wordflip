import { describe, expect, it } from 'vitest';
import {
  seededShuffle,
  selectBrowseCard,
  selectNextCard,
} from '../queue/cardSelector';
import type { SelectorContext } from '../queue/queueTypes';
import type { CardSchedule } from '../types';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const NOW = Date.UTC(2027, 0, 15, 12, 0, 0);

function ctx(overrides: Partial<SelectorContext>): SelectorContext {
  return {
    nowMs: NOW,
    studyStep: 100,
    schedules: new Map<string, CardSchedule>(),
    deckIds: [],
    newIds: [],
    recentIds: [],
    avoidRecentCount: 5,
    currentCardId: null,
    desiredRetention: 0.9,
    ...overrides,
  };
}

function makeSchedule(
  overrides: Partial<CardSchedule> & { cardId: string },
): CardSchedule {
  return {
    dueAt: NOW - MINUTE_MS,
    minReviewStep: 0,
    stability: 10,
    difficulty: 5,
    elapsedDays: 10,
    scheduledDays: 10,
    learningSteps: 0,
    reps: 3,
    lapses: 0,
    state: 'review',
    lastReviewAt: NOW - 10 * DAY_MS,
    lastRating: 'good',
    algorithm: 'fsrs-6',
    ...overrides,
  };
}

function scheduleMap(list: CardSchedule[]): Map<string, CardSchedule> {
  return new Map(list.map((schedule) => [schedule.cardId, schedule]));
}

describe('FSRS 실시간 큐 선택', () => {
  it('dueAt과 minReviewStep을 모두 지난 카드만 신규 카드보다 우선한다', () => {
    const result = selectNextCard(
      ctx({
        schedules: scheduleMap([makeSchedule({ cardId: 'due' })]),
        deckIds: ['due', 'new'],
        newIds: ['new'],
      }),
    );

    expect(result).toEqual({
      cardId: 'due',
      isDueReview: true,
      isNew: false,
      nextDueAt: null,
      nextReviewStep: null,
    });
  });

  it('FSRS 시간이 오지 않은 카드는 절대 일찍 다시 꺼내지 않는다', () => {
    const dueAt = NOW + 10 * MINUTE_MS;
    const result = selectNextCard(
      ctx({
        schedules: scheduleMap([
          makeSchedule({ cardId: 'again', dueAt, state: 'relearning' }),
        ]),
        deckIds: ['again'],
      }),
    );

    expect(result.cardId).toBeNull();
    expect(result.isDueReview).toBe(false);
    expect(result.nextDueAt).toBe(dueAt);
    expect(result.nextReviewStep).toBeNull();
  });

  it('미래 복습 카드 대신 신규 카드를 계속 보여준다', () => {
    const result = selectNextCard(
      ctx({
        schedules: scheduleMap([
          makeSchedule({
            cardId: 'again',
            dueAt: NOW + 10 * MINUTE_MS,
            state: 'relearning',
          }),
        ]),
        deckIds: ['again', 'new'],
        newIds: ['new'],
      }),
    );

    expect(result.cardId).toBe('new');
    expect(result.isNew).toBe(true);
    expect(result.nextDueAt).toBeNull();
  });

  it('dueAt이 지나도 minReviewStep 전이면 대안 신규 카드를 고른다', () => {
    const result = selectNextCard(
      ctx({
        studyStep: 100,
        schedules: scheduleMap([
          makeSchedule({ cardId: 'gated', minReviewStep: 105 }),
        ]),
        deckIds: ['gated', 'new'],
        newIds: ['new'],
      }),
    );

    expect(result.cardId).toBe('new');
    expect(result.isNew).toBe(true);
  });

  it('dueAt과 minReviewStep 조건을 모두 만족하면 복습한다', () => {
    const result = selectNextCard(
      ctx({
        studyStep: 105,
        schedules: scheduleMap([
          makeSchedule({ cardId: 'ready', minReviewStep: 105 }),
        ]),
        deckIds: ['ready', 'new'],
        newIds: ['new'],
      }),
    );

    expect(result.cardId).toBe('ready');
    expect(result.isDueReview).toBe(true);
  });

  it('한 장짜리 덱은 시간 바닥이 지난 뒤 step gate를 최후 수단으로 완화한다', () => {
    const result = selectNextCard(
      ctx({
        studyStep: 100,
        schedules: scheduleMap([
          makeSchedule({ cardId: 'only', minReviewStep: 110 }),
        ]),
        deckIds: ['only'],
        currentCardId: 'only',
      }),
    );

    expect(result.cardId).toBe('only');
    expect(result.isDueReview).toBe(true);
    expect(result.nextReviewStep).toBeNull();
  });

  it('학습/재학습 due 카드를 일반 review보다 먼저 고른다', () => {
    const schedules = scheduleMap([
      makeSchedule({
        cardId: 'review-low-r',
        stability: 1,
        lastReviewAt: NOW - 30 * DAY_MS,
      }),
      makeSchedule({
        cardId: 'learning',
        state: 'learning',
        dueAt: NOW - MINUTE_MS,
      }),
      makeSchedule({
        cardId: 'relearning',
        state: 'relearning',
        dueAt: NOW - 2 * MINUTE_MS,
      }),
    ]);

    const result = selectNextCard(
      ctx({
        schedules,
        deckIds: ['review-low-r', 'learning', 'relearning'],
      }),
    );

    expect(result.cardId).toBe('relearning');
  });

  it('일반 review는 회상 가능성이 낮은 카드부터 고른다', () => {
    const schedules = scheduleMap([
      makeSchedule({
        cardId: 'strong',
        stability: 30,
        lastReviewAt: NOW - 10 * DAY_MS,
      }),
      makeSchedule({
        cardId: 'weak',
        stability: 2,
        lastReviewAt: NOW - 10 * DAY_MS,
      }),
    ]);

    const result = selectNextCard(
      ctx({ schedules, deckIds: ['strong', 'weak'] }),
    );

    expect(result.cardId).toBe('weak');
  });

  it('회상 가능성이 같으면 dueAt → lastReviewAt → cardId 순으로 결정한다', () => {
    const base = {
      stability: 10,
      lastReviewAt: NOW - 10 * DAY_MS,
    };
    const schedules = scheduleMap([
      makeSchedule({ cardId: 'z', dueAt: NOW - MINUTE_MS, ...base }),
      makeSchedule({ cardId: 'b', dueAt: NOW - 2 * MINUTE_MS, ...base }),
      makeSchedule({ cardId: 'a', dueAt: NOW - 2 * MINUTE_MS, ...base }),
    ]);

    expect(
      selectNextCard(ctx({ schedules, deckIds: ['z', 'b', 'a'] })).cardId,
    ).toBe('a');
  });

  it('Again 및 누적 lapse에 별도 수동 우선 보너스를 주지 않는다', () => {
    const sameMemory = {
      stability: 10,
      lastReviewAt: NOW - 10 * DAY_MS,
    };
    const schedules = scheduleMap([
      makeSchedule({
        cardId: 'ordinary',
        dueAt: NOW - 2 * MINUTE_MS,
        lapses: 0,
        lastRating: 'good',
        ...sameMemory,
      }),
      makeSchedule({
        cardId: 'many-lapses',
        dueAt: NOW - MINUTE_MS,
        lapses: 100,
        lastRating: 'again',
        ...sameMemory,
      }),
    ]);

    const result = selectNextCard(
      ctx({ schedules, deckIds: ['ordinary', 'many-lapses'] }),
    );

    expect(result.cardId).toBe('ordinary');
  });

  it('최근 카드와 현재 카드는 due 대안이 있으면 피한다', () => {
    const schedules = scheduleMap([
      makeSchedule({ cardId: 'recent', stability: 1 }),
      makeSchedule({ cardId: 'current', stability: 2 }),
      makeSchedule({ cardId: 'other', stability: 20 }),
    ]);

    const result = selectNextCard(
      ctx({
        schedules,
        deckIds: ['recent', 'current', 'other'],
        recentIds: ['x', 'recent'],
        currentCardId: 'current',
      }),
    );

    expect(result.cardId).toBe('other');
  });

  it('모든 due 카드가 최근 목록에 있으면 가장 우선인 due 카드를 허용한다', () => {
    const schedules = scheduleMap([
      makeSchedule({ cardId: 'weak', stability: 1 }),
      makeSchedule({ cardId: 'strong', stability: 20 }),
    ]);

    const result = selectNextCard(
      ctx({
        schedules,
        deckIds: ['weak', 'strong'],
        recentIds: ['weak', 'strong'],
      }),
    );

    expect(result.cardId).toBe('weak');
  });

  it('신규 카드도 최근/현재 항목을 대안이 있을 때 피하고 덱 순서를 보존한다', () => {
    const result = selectNextCard(
      ctx({
        deckIds: ['n1', 'n2', 'n3'],
        newIds: ['outside', 'n1', 'n2', 'n3'],
        recentIds: ['n1'],
        currentCardId: 'n2',
      }),
    );

    expect(result.cardId).toBe('n3');
    expect(result.isNew).toBe(true);
  });

  it('모든 신규 카드가 회피 대상이면 현재 카드가 아닌 신규 카드를 허용한다', () => {
    const result = selectNextCard(
      ctx({
        deckIds: ['n1', 'n2'],
        newIds: ['n1', 'n2'],
        recentIds: ['n1'],
        currentCardId: 'n2',
      }),
    );

    expect(result.cardId).toBe('n1');
  });

  it('due도 신규도 없으면 미래 카드를 강제하지 않고 가장 이른 dueAt을 알린다', () => {
    const earliest = NOW + 30 * MINUTE_MS;
    const schedules = scheduleMap([
      makeSchedule({ cardId: 'later', dueAt: NOW + DAY_MS }),
      makeSchedule({ cardId: 'earliest', dueAt: earliest }),
      makeSchedule({ cardId: 'outside', dueAt: NOW + MINUTE_MS }),
    ]);

    const result = selectNextCard(
      ctx({ schedules, deckIds: ['later', 'earliest'] }),
    );

    expect(result).toEqual({
      cardId: null,
      isDueReview: false,
      isNew: false,
      nextDueAt: earliest,
      nextReviewStep: null,
    });
  });

  it('현재 모드의 deckIds 밖 카드는 due여도 선택하지 않는다', () => {
    const schedules = scheduleMap([
      makeSchedule({ cardId: 'search-out', stability: 1 }),
      makeSchedule({ cardId: 'search-in', stability: 20 }),
    ]);

    const result = selectNextCard(
      ctx({ schedules, deckIds: ['search-in'] }),
    );

    expect(result.cardId).toBe('search-in');
  });

  it('빈 덱이면 대기 정보도 없는 null 결과를 반환한다', () => {
    expect(selectNextCard(ctx({ deckIds: [] }))).toEqual({
      cardId: null,
      isDueReview: false,
      isNew: false,
      nextDueAt: null,
      nextReviewStep: null,
    });
  });

  it('5,000장에서도 100회 선택을 1초 안에 마친다', () => {
    const count = 5_000;
    const deckIds = Array.from({ length: count }, (_, index) => `c${index}`);
    const schedules = scheduleMap(
      deckIds.slice(0, 4_000).map((cardId, index) =>
        makeSchedule({
          cardId,
          dueAt: NOW - ((index % 120) + 1) * MINUTE_MS,
          stability: (index % 30) + 1,
          lastReviewAt: NOW - ((index % 60) + 1) * DAY_MS,
        }),
      ),
    );
    const newIds = deckIds.slice(4_000);
    const startedAt = performance.now();

    for (let index = 0; index < 100; index += 1) {
      selectNextCard(
        ctx({
          schedules,
          deckIds,
          newIds,
          recentIds: deckIds.slice(index, index + 5),
        }),
      );
    }

    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});

describe('전체 둘러보기와 신규 순서', () => {
  it('browse는 due 여부와 무관하게 양방향 index를 순환한다', () => {
    const ids = ['a', 'b', 'c'];
    expect(selectBrowseCard(ids, 0)).toEqual({ cardId: 'a', nextIndex: 0 });
    expect(selectBrowseCard(ids, 3)).toEqual({ cardId: 'a', nextIndex: 0 });
    expect(selectBrowseCard(ids, -1)).toEqual({ cardId: 'c', nextIndex: 2 });
  });

  it('browse 빈 목록은 null이다', () => {
    expect(selectBrowseCard([], 10)).toEqual({ cardId: null, nextIndex: 0 });
  });

  it('seeded shuffle은 같은 seed에서 결정적이며 원본을 바꾸지 않는다', () => {
    const original = ['a', 'b', 'c', 'd', 'e'];
    const first = seededShuffle(original, 42);
    const second = seededShuffle(original, 42);

    expect(first).toEqual(second);
    expect(first).not.toEqual(original);
    expect([...first].sort()).toEqual([...original].sort());
    expect(original).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
