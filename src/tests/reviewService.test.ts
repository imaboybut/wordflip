import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, getMeta, type WordFlipDB } from '../db/database';
import { META_KEYS } from '../db/schema';
import {
  applyRating,
  rebuildSchedulesFromLogs,
  undoLastReview,
} from '../services/reviewService';
import { makeCard, uniqueDbName } from './helpers';

describe('복습 트랜잭션', () => {
  let db: WordFlipDB;

  beforeEach(async () => {
    db = createDatabase(uniqueDbName());
    await db.cards.bulkAdd([
      makeCard({ id: 'c1' }),
      makeCard({ id: 'c2', orderIndex: 1 }),
    ]);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('평가 1회마다 studyStep이 정확히 1 증가한다', async () => {
    expect(await getMeta(db, META_KEYS.studyStep, 0)).toBe(0);
    await applyRating(db, 'c1', 'good', false);
    expect(await getMeta(db, META_KEYS.studyStep, 0)).toBe(1);
    await applyRating(db, 'c2', 'again', false);
    expect(await getMeta(db, META_KEYS.studyStep, 0)).toBe(2);
  });

  it('스케줄, 로그, 최근 목록, 통계가 모두 함께 갱신된다', async () => {
    const outcome = await applyRating(db, 'c1', 'good', false);
    expect(outcome.schedule.intervalSteps).toBe(40);
    expect(outcome.schedule.dueStep).toBe(41);

    const logs = await db.reviewLogs.toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      cardId: 'c1',
      stepBefore: 0,
      stepAfter: 1,
      rating: 'good',
      intervalBefore: 0,
      intervalAfter: 40,
    });

    expect(await getMeta(db, META_KEYS.recentIds, [])).toEqual(['c1']);
    expect(await getMeta(db, META_KEYS.ratingCounts, null)).toMatchObject({
      good: 1,
    });
  });

  it('reviewStreak: due 복습이면 +1, 아니면 0으로 리셋', async () => {
    await applyRating(db, 'c1', 'good', true);
    expect(await getMeta(db, META_KEYS.reviewStreak, -1)).toBe(1);
    await applyRating(db, 'c2', 'good', true);
    expect(await getMeta(db, META_KEYS.reviewStreak, -1)).toBe(2);
    await applyRating(db, 'c1', 'good', false);
    expect(await getMeta(db, META_KEYS.reviewStreak, -1)).toBe(0);
  });

  it('마지막 평가 한 번 되돌리기', async () => {
    await applyRating(db, 'c1', 'good', false);
    const before = await db.schedules.get('c1');
    expect(before).toBeDefined();

    const undone = await undoLastReview(db);
    expect(undone?.cardId).toBe('c1');
    expect(await getMeta(db, META_KEYS.studyStep, -1)).toBe(0);
    expect(await db.schedules.get('c1')).toBeUndefined();
    expect(await db.reviewLogs.count()).toBe(0);

    // 연속 되돌리기는 불가 (한 번만)
    expect(await undoLastReview(db)).toBeNull();
  });

  it('기존 카드 되돌리기는 이전 스케줄을 복원한다', async () => {
    await applyRating(db, 'c1', 'good', false);
    const first = await db.schedules.get('c1');
    await applyRating(db, 'c1', 'easy', false);

    await undoLastReview(db);
    const restored = await db.schedules.get('c1');
    expect(restored).toEqual(first);
    expect(await getMeta(db, META_KEYS.studyStep, -1)).toBe(1);
  });

  it('복습 로그로 전체 스케줄을 재계산할 수 있다', async () => {
    await applyRating(db, 'c1', 'good', false);
    await applyRating(db, 'c2', 'again', false);
    await applyRating(db, 'c1', 'easy', true);
    const expected = await db.schedules.toArray();
    const expectedStep = await getMeta(db, META_KEYS.studyStep, 0);

    // 스케줄을 일부러 손상시킨다
    await db.schedules.put({
      cardId: 'c1',
      dueStep: NaN,
      intervalSteps: -5,
      repetitions: 0,
      lapses: 0,
      ease: NaN,
      lastRating: null,
      lastReviewedStep: null,
      firstSeenStep: null,
    });

    const rebuilt = await rebuildSchedulesFromLogs(db);
    expect(rebuilt.studyStep).toBe(expectedStep);
    const after = await db.schedules.toArray();
    const sortById = (arr: typeof after) =>
      arr.slice().sort((a, b) => a.cardId.localeCompare(b.cardId));
    expect(sortById(after)).toEqual(sortById(expected));
  });

  it('동시에 두 번 호출하면 두 번째는 거부된다 (중복 평가 방지)', async () => {
    const p1 = applyRating(db, 'c1', 'good', false);
    const p2 = applyRating(db, 'c1', 'good', false);
    const results = await Promise.allSettled([p1, p2]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(await getMeta(db, META_KEYS.studyStep, 0)).toBe(1);
    expect(await db.reviewLogs.count()).toBe(1);
  });
});
