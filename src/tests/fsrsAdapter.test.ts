import { Rating, State } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import {
  createFsrsAdapter,
  createStoredFsrsCard,
  fsrsCardToStored,
  storedCardToFsrs,
  type FsrsRating,
} from '../scheduler/fsrsAdapter';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const START = Date.parse('2026-01-01T00:00:00.000Z');

describe('FSRS adapter', () => {
  it('uses production defaults and clamps desired retention to Anki limits', () => {
    const defaults = createFsrsAdapter();

    expect(defaults.desiredRetention).toBe(0.9);
    expect(defaults.enableFuzz).toBe(true);
    expect(defaults.learningSteps).toEqual(['30m']);
    expect(defaults.relearningSteps).toEqual(['30m']);
    expect(createFsrsAdapter(-1).desiredRetention).toBe(0.8);
    expect(createFsrsAdapter(2).desiredRetention).toBe(0.97);
  });

  it('Again 30분·Hard 2시간 하한을 적용하고 Good은 일 단위로 졸업한다', () => {
    const adapter = createFsrsAdapter(0.9, { enableFuzz: false });
    const preview = adapter.preview(null, START);

    expect(preview.again.card.dueAt - START).toBe(30 * MINUTE_MS);
    expect(preview.hard.card.dueAt - START).toBe(2 * 60 * MINUTE_MS);
    expect(preview.good.card.dueAt - START).toBeGreaterThanOrEqual(DAY_MS);
    expect(preview.good.card.state).toBe('review');
  });

  it('FSRS가 2시간보다 긴 Hard 간격을 계산하면 단축하지 않는다', () => {
    const adapter = createFsrsAdapter(0.9, { enableFuzz: false });
    const learned = adapter.rate(null, 'good', START).card;
    const reviewedAt = learned.dueAt;
    const hard = adapter.rate(learned, 'hard', reviewedAt).card;

    expect(hard.dueAt).toBeGreaterThan(reviewedAt + 2 * 60 * MINUTE_MS);
  });

  it('previews all four ratings in increasing interval order for a new card', () => {
    const preview = createFsrsAdapter(0.9, { enableFuzz: false }).preview(
      null,
      START,
    );
    const dueTimes = (['again', 'hard', 'good', 'easy'] as FsrsRating[]).map(
      (rating) => preview[rating].card.dueAt,
    );

    expect(Object.keys(preview)).toEqual(['again', 'hard', 'good', 'easy']);
    expect(dueTimes[0]).toBeLessThan(dueTimes[1]);
    expect(dueTimes[1]).toBeLessThan(dueTimes[2]);
    expect(dueTimes[2]).toBeLessThan(dueTimes[3]);
  });

  it('schedules sooner when desired retention is higher', () => {
    const lowerRetention = createFsrsAdapter(0.8, { enableFuzz: false });
    const higherRetention = createFsrsAdapter(0.95, { enableFuzz: false });

    const lowerDue = lowerRetention.rate(null, 'good', START).card.dueAt;
    const higherDue = higherRetention.rate(null, 'good', START).card.dueAt;

    expect(higherDue).toBeLessThan(lowerDue);
  });

  it('reports retrievability that decreases as time passes', () => {
    const adapter = createFsrsAdapter(0.9, { enableFuzz: false });
    const learned = adapter.rate(null, 'good', START).card;

    const immediately = adapter.retrievability(learned, START);
    const aWeekLater = adapter.retrievability(learned, START + 7 * DAY_MS);

    expect(immediately).toBeCloseTo(1, 8);
    expect(aWeekLater).toBeGreaterThan(0);
    expect(aWeekLater).toBeLessThan(immediately);
  });

  it('repeated Again raises difficulty and keeps the next success shorter', () => {
    const adapter = createFsrsAdapter(0.9, { enableFuzz: false });
    const cleanGood = adapter.rate(null, 'good', START).card;
    let oftenMissed = adapter.rate(null, 'again', START).card;
    oftenMissed = adapter.rate(oftenMissed, 'again', oftenMissed.dueAt).card;
    oftenMissed = adapter.rate(oftenMissed, 'again', oftenMissed.dueAt).card;
    const recovered = adapter.rate(oftenMissed, 'good', oftenMissed.dueAt).card;

    expect(oftenMissed.difficulty).toBeGreaterThan(cleanGood.difficulty);
    expect(oftenMissed.stability).toBeLessThan(cleanGood.stability);
    expect(recovered.scheduledDays).toBeLessThan(cleanGood.scheduledDays);
  });

  it('replays rating history in timestamp order', () => {
    const adapter = createFsrsAdapter(0.9, { enableFuzz: false });
    const history = [
      { rating: 'easy' as const, reviewedAt: START + 3 * DAY_MS },
      {
        rating: 'good' as const,
        reviewedAt: new Date(START).toISOString(),
      },
      { rating: 'again' as const, reviewedAt: START + 2 * DAY_MS },
    ];

    const replayed = adapter.replay(history, START);
    let expected = adapter.rate(null, 'good', START).card;
    expected = adapter.rate(expected, 'again', START + 2 * DAY_MS).card;
    expected = adapter.rate(expected, 'easy', START + 3 * DAY_MS).card;

    expect(replayed.card).toEqual(expected);
    expect(replayed.logs.map((log) => log.rating)).toEqual([
      'good',
      'again',
      'easy',
    ]);
  });

  it('round-trips Date fields as serializable milliseconds and clamps bad storage data', () => {
    const empty = createStoredFsrsCard(START);
    const native = storedCardToFsrs(empty, START);

    expect(native.due).toEqual(new Date(START));
    expect(native.state).toBe(State.New);
    expect(fsrsCardToStored(native)).toEqual(empty);

    const repaired = storedCardToFsrs(
      {
        ...empty,
        dueAt: Number.POSITIVE_INFINITY,
        stability: -100,
        difficulty: 100,
        scheduledDays: -2.2,
        reps: Number.NaN,
        state: 'not-a-state' as 'new',
        lastReviewAt: Number.NaN,
      },
      START,
    );

    expect(repaired.due.getTime()).toBe(START);
    expect(repaired.stability).toBe(0);
    expect(repaired.difficulty).toBe(10);
    expect(repaired.scheduled_days).toBe(0);
    expect(repaired.reps).toBe(0);
    expect(repaired.state).toBe(State.New);
    expect(repaired.last_review).toBeUndefined();
  });

  it('maps all public ratings to the corresponding ts-fsrs grade', () => {
    const preview = createFsrsAdapter(0.9, { enableFuzz: false }).preview(
      null,
      START,
    );

    expect(preview.again.log.nativeRating).toBe(Rating.Again);
    expect(preview.hard.log.nativeRating).toBe(Rating.Hard);
    expect(preview.good.log.nativeRating).toBe(Rating.Good);
    expect(preview.easy.log.nativeRating).toBe(Rating.Easy);
  });
});
