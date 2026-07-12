import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, getMeta, type WordFlipDB } from '../db/database';
import { META_KEYS } from '../db/schema';
import {
  MAX_AGAIN_CARD_GAP,
  MIN_AGAIN_CARD_GAP,
  applyRating,
  migrateLegacySchedulesToFsrs,
  rebuildSchedulesFromLogs,
  undoLastReview,
} from '../services/reviewService';
import { makeCard, uniqueDbName } from './helpers';

const START = Date.parse('2026-07-12T12:00:00.000Z');
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const fixed = (nowMs: number) => ({ nowMs, enableFuzz: false });

describe('FSRS 복습 트랜잭션', () => {
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

  it('평가 1회마다 누적 평가 횟수가 정확히 1 증가한다', async () => {
    await applyRating(db, 'c1', 'good', false, fixed(START));
    await applyRating(db, 'c2', 'again', false, fixed(START + 1));
    expect(await getMeta(db, META_KEYS.studyStep, 0)).toBe(2);
  });

  it('스케줄·v3 로그·최근 목록·통계를 한 트랜잭션에서 저장한다', async () => {
    const outcome = await applyRating(db, 'c1', 'good', false, fixed(START));
    expect(outcome.schedule).toMatchObject({
      cardId: 'c1',
      algorithm: 'fsrs-6',
      state: 'review',
      scheduledDays: 2,
      lastRating: 'good',
    });
    expect(outcome.schedule.dueAt).toBe(START + 2 * DAY_MS);

    const [log] = await db.reviewLogs.toArray();
    expect(log).toMatchObject({
      cardId: 'c1',
      stepBefore: 0,
      stepAfter: 1,
      rating: 'good',
      intervalBefore: 0,
      intervalAfter: 2,
      schedulerVersion: 3,
      reviewedAt: new Date(START).toISOString(),
      scheduleAfter: outcome.schedule,
    });
    expect(await getMeta(db, META_KEYS.recentIds, [])).toEqual(['c1']);
    expect(await getMeta(db, META_KEYS.ratingCounts, null)).toMatchObject({ good: 1 });
  });

  it('Again은 10분 시간 바닥과 12~24장 무작위 최소 간격을 함께 저장한다', async () => {
    const outcome = await applyRating(db, 'c1', 'again', false, fixed(START));
    const cardGap = outcome.schedule.minReviewStep - outcome.studyStep;
    expect(outcome.schedule.dueAt).toBe(START + 10 * MINUTE_MS);
    expect(outcome.schedule.state).toBe('learning');
    expect(cardGap).toBeGreaterThanOrEqual(MIN_AGAIN_CARD_GAP);
    expect(cardGap).toBeLessThanOrEqual(MAX_AGAIN_CARD_GAP);
  });

  it('옛 reviewStreak은 FSRS 선택에 쓰지 않고 0으로 정리한다', async () => {
    await db.meta.put({ key: META_KEYS.reviewStreak, value: 10 });
    await applyRating(db, 'c1', 'good', true, fixed(START));
    expect(await getMeta(db, META_KEYS.reviewStreak, -1)).toBe(0);
  });

  it('평가와 다음 화면 세션을 같은 트랜잭션에서 저장한다', async () => {
    const studySession = {
      mode: { type: 'mix' as const },
      currentCardId: null,
      flipped: false,
      currentWasDue: false,
      awaitingAdvance: false,
    };
    await applyRating(db, 'c1', 'again', false, {
      ...fixed(START),
      studySession,
    });
    expect(await getMeta(db, META_KEYS.studySession, null)).toEqual(studySession);
  });

  it('마지막 평가를 되돌리면 스케줄·로그·카운터가 함께 복원된다', async () => {
    await applyRating(db, 'c1', 'good', false, fixed(START));
    const undone = await undoLastReview(db);
    expect(undone?.cardId).toBe('c1');
    expect(await getMeta(db, META_KEYS.studyStep, -1)).toBe(0);
    expect(await db.schedules.get('c1')).toBeUndefined();
    expect(await db.reviewLogs.count()).toBe(0);
    expect(await undoLastReview(db)).toBeNull();
  });

  it('기존 카드의 마지막 평가를 되돌리면 정확한 FSRS snapshot을 복원한다', async () => {
    await applyRating(db, 'c1', 'good', false, fixed(START));
    const first = await db.schedules.get('c1');
    await applyRating(db, 'c1', 'easy', true, fixed(START + 2 * DAY_MS));
    await undoLastReview(db);
    expect(await db.schedules.get('c1')).toEqual(first);
  });

  it('v3 로그 snapshot으로 손상된 스케줄을 정확히 재구성한다', async () => {
    await applyRating(db, 'c1', 'good', false, fixed(START));
    await applyRating(db, 'c2', 'again', false, fixed(START + 1));
    await applyRating(db, 'c1', 'easy', true, fixed(START + 2 * DAY_MS));
    const expected = await db.schedules.toArray();
    await db.schedules.clear();

    const rebuilt = await rebuildSchedulesFromLogs(db);
    const byId = (items: typeof expected) =>
      items.slice().sort((a, b) => a.cardId.localeCompare(b.cardId));
    expect(byId(rebuilt.schedules)).toEqual(byId(expected));
  });

  it('v1/v2 로그의 실제 reviewedAt을 재생해 FSRS로 마이그레이션한다', async () => {
    await db.reviewLogs.bulkAdd([
      {
        id: 'legacy-1', cardId: 'c1', stepBefore: 0, stepAfter: 1,
        rating: 'again', intervalBefore: 0, intervalAfter: 3,
        schedulerVersion: 2, reviewedAt: new Date(START).toISOString(),
      },
      {
        id: 'legacy-2', cardId: 'c1', stepBefore: 1, stepAfter: 2,
        rating: 'good', intervalBefore: 3, intervalAfter: 200,
        schedulerVersion: 2,
        reviewedAt: new Date(START + 10 * MINUTE_MS).toISOString(),
      },
    ]);
    await db.schedules.put({
      cardId: 'c1', dueStep: 202, intervalSteps: 200, repetitions: 2,
      lapses: 1, ease: 2.3, lastRating: 'good', lastReviewedStep: 2,
      firstSeenStep: 1,
    } as never);
    await db.meta.put({ key: META_KEYS.fsrsMigrationPending, value: true });

    const migrated = await migrateLegacySchedulesToFsrs(db);
    expect(migrated.migrated).toBe(true);
    expect(migrated.schedules[0]).toMatchObject({
      cardId: 'c1', algorithm: 'fsrs-6', lastRating: 'good', reps: 2,
    });
    expect(Number.isFinite(migrated.schedules[0].dueAt)).toBe(true);
    expect(await getMeta(db, META_KEYS.fsrsMigrationPending, true)).toBe(false);
  });

  it('동시에 두 번 평가하면 한 번만 기록한다', async () => {
    const p1 = applyRating(db, 'c1', 'good', false, fixed(START));
    const p2 = applyRating(db, 'c1', 'good', false, fixed(START));
    const results = await Promise.allSettled([p1, p2]);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await db.reviewLogs.count()).toBe(1);
  });
});
