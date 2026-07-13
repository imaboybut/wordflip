import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { createDatabase, getMeta, type WordFlipDB } from '../db/database';
import { META_KEYS } from '../db/schema';
import { applyRating } from '../services/reviewService';
import {
  exportBackup,
  restoreBackup,
  validateBackup,
  wipeAllData,
} from '../services/backupService';
import { importCards } from '../services/importService';
import {
  migrateLegacySchedulesToFsrs,
  rebuildSchedulesFromLogs,
} from '../services/reviewService';
import { parseWordsCsv } from '../services/csvService';
import { makeCard, makeSchedule, uniqueDbName } from './helpers';
import { DEFAULT_SETTINGS } from '../types';

describe('JSON 백업/복원', () => {
  let db: WordFlipDB;

  beforeEach(async () => {
    db = createDatabase(uniqueDbName());
    await db.cards.bulkAdd([
      makeCard({ id: 'c1', word: 'alpha', starred: true }),
      makeCard({ id: 'c2', word: 'beta', orderIndex: 1 }),
    ]);
    await applyRating(db, 'c1', 'good', false);
    await applyRating(db, 'c2', 'hard', false);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('백업 → 복원 round-trip으로 모든 학습 상태가 보존된다', async () => {
    await db.meta.put({ key: META_KEYS.reviewStreak, value: 2 });
    const backup = await exportBackup(db);
    expect(backup.version).toBe(2);
    expect(backup.cards).toHaveLength(2);
    expect(backup.schedules).toHaveLength(2);
    expect(backup.reviewLogs).toHaveLength(2);
    expect(backup.studyStep).toBe(2);
    expect(backup.reviewStreak).toBe(2);

    const db2 = createDatabase(uniqueDbName());
    try {
      const result = await restoreBackup(db2, JSON.parse(JSON.stringify(backup)));
      expect(result).toEqual({ cards: 2, schedules: 2, reviewLogs: 2 });
      expect(await getMeta(db2, META_KEYS.studyStep, -1)).toBe(2);
      expect(await getMeta(db2, META_KEYS.reviewStreak, -1)).toBe(2);
      expect(await db2.cards.get('c1')).toMatchObject({
        word: 'alpha',
        starred: true,
      });
      const restoredSchedules = await db2.schedules.toArray();
      const originalSchedules = await db.schedules.toArray();
      expect(restoredSchedules.sort((a, b) => a.cardId.localeCompare(b.cardId)))
        .toEqual(originalSchedules.sort((a, b) => a.cardId.localeCompare(b.cardId)));
    } finally {
      await db2.delete();
    }
  });

  it('잘못된 백업 파일은 거부한다', () => {
    expect(() => validateBackup(null)).toThrow();
    expect(() => validateBackup({ app: 'other' })).toThrow();
    expect(() =>
      validateBackup({ app: 'wordflip', version: 1, cards: 'nope' }),
    ).toThrow();
    expect(() =>
      validateBackup({
        app: 'wordflip',
        version: 1,
        cards: [],
        schedules: [],
        reviewLogs: [],
        studyStep: -1,
      }),
    ).toThrow();
    expect(() =>
      validateBackup({
        app: 'wordflip', version: 2, cards: [makeCard({ id: 'bad' })],
        schedules: [makeSchedule({ cardId: 'bad', state: 'review', lastReviewAt: null })],
        reviewLogs: [], studyStep: 0,
      }),
    ).toThrow(/FSRS/);
    expect(() =>
      validateBackup({
        app: 'wordflip', version: 1, cards: [makeCard({ id: 'bad' })],
        schedules: [], studyStep: 1,
        reviewLogs: [{
          id: 'bad-log', cardId: 'bad', rating: 'again', reviewedAt: 'not-a-date',
        }],
      }),
    ).toThrow(/복습 로그/);
  });

  it('v1 step 백업을 복원하면 실제 reviewedAt을 사용한 FSRS 상태로 변환한다', async () => {
    const legacy = {
      app: 'wordflip',
      version: 1,
      exportedAt: '2026-01-02T00:00:00.000Z',
      studyStep: 1,
      settings: { ...DEFAULT_SETTINGS, desiredRetention: undefined },
      recentIds: ['c1'],
      reviewStreak: 0,
      ratingCounts: { again: 1, hard: 0, good: 0, easy: 0 },
      cards: [makeCard({ id: 'c1' })],
      schedules: [{
        cardId: 'c1', dueStep: 4, intervalSteps: 3, repetitions: 1,
        lapses: 1, ease: 2.3, lastRating: 'again', lastReviewedStep: 1,
        firstSeenStep: 1,
      }],
      reviewLogs: [{
        id: 'old-log', cardId: 'c1', stepBefore: 0, stepAfter: 1,
        rating: 'again', intervalBefore: 0, intervalAfter: 3,
        schedulerVersion: 2,
        reviewedAt: '2026-01-01T00:00:00.000Z',
      }],
    };
    const target = createDatabase(uniqueDbName());
    try {
      await restoreBackup(target, legacy);
      const schedule = await target.schedules.get('c1');
      expect(schedule).toMatchObject({
        algorithm: 'fsrs-6', lastRating: 'again', state: 'learning',
      });
      expect(schedule?.dueAt).toBe(Date.parse('2026-01-01T00:30:00.000Z'));
      expect((await getMeta(target, META_KEYS.settings, DEFAULT_SETTINGS)).desiredRetention)
        .toBe(0.9);
    } finally {
      await target.delete();
    }
  });

  it('전체 초기화는 모든 테이블을 비운다', async () => {
    await wipeAllData(db);
    expect(await db.cards.count()).toBe(0);
    expect(await db.schedules.count()).toBe(0);
    expect(await db.reviewLogs.count()).toBe(0);
    expect(await db.meta.count()).toBe(0);
  });
});

const HEADER =
  'id,word,part_of_speech,korean_meaning,korean_pronunciation,example_sentence,example_translation,category,difficulty,tags,starred';

describe('CSV import 병합/교체', () => {
  let db: WordFlipDB;

  beforeEach(async () => {
    db = createDatabase(uniqueDbName());
    await db.cards.bulkAdd([
      makeCard({ id: '1', word: 'alpha' }),
      makeCard({ id: '2', word: 'beta', orderIndex: 1 }),
    ]);
    await applyRating(db, '1', 'good', false);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('병합: 같은 id는 갱신, 같은 단어는 건너뜀, 새 단어는 추가', async () => {
    const csv = [
      HEADER,
      '1,alpha,noun,새로운 뜻,발음,ex,tr,conversation,A1,,false',
      '99,BETA,noun,중복단어,발음,ex,tr,conversation,A1,,false',
      '100,gamma,noun,감마,발음,ex,tr,conversation,A1,,false',
    ].join('\n');
    const result = await importCards(db, parseWordsCsv(csv), {
      mode: 'merge',
      preserveProgress: true,
    });
    expect(result.updated).toBe(1);
    expect(result.added).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('같은 단어');

    expect(await db.cards.count()).toBe(3);
    expect((await db.cards.get('1'))?.koreanMeaning).toBe('새로운 뜻');
    // 복습 기록 유지
    expect(await db.schedules.get('1')).toBeDefined();
  });

  it('교체 + 기록 보존: 같은 단어의 스케줄이 새 id로 이어진다', async () => {
    const csv = [
      HEADER,
      'new-1,ALPHA,noun,알파,발음,ex,tr,conversation,A1,,false',
      'new-2,delta,noun,델타,발음,ex,tr,conversation,A1,,false',
    ].join('\n');
    const result = await importCards(db, parseWordsCsv(csv), {
      mode: 'replace',
      preserveProgress: true,
    });
    expect(result.added).toBe(2);
    expect(result.progressPreserved).toBe(1);
    expect(await db.cards.count()).toBe(2);
    const preserved = await db.schedules.get('new-1');
    expect(preserved).toBeDefined();
    expect(preserved?.scheduledDays).toBeGreaterThan(0);
    expect(await db.reviewLogs.count()).toBe(1);
    expect((await db.reviewLogs.toArray())[0]).toMatchObject({
      cardId: 'new-1',
      scheduleAfter: { cardId: 'new-1' },
    });
    await rebuildSchedulesFromLogs(db);
    expect(await db.schedules.get('new-1')).toBeDefined();
  });

  it('교체 + 기록 미보존: 학습 상태가 완전히 초기화된다', async () => {
    const csv = [HEADER, 'n1,omega,noun,오메가,발음,ex,tr,conversation,A1,,false'].join(
      '\n',
    );
    await importCards(db, parseWordsCsv(csv), {
      mode: 'replace',
      preserveProgress: false,
    });
    expect(await db.schedules.count()).toBe(0);
    expect(await db.reviewLogs.count()).toBe(0);
    expect(await getMeta(db, META_KEYS.studyStep, -1)).toBe(0);
  });
});

describe('스키마 마이그레이션', () => {
  it('v1 데이터가 v3로 업그레이드되어도 카드와 meta가 보존된다', async () => {
    const name = uniqueDbName();

    // v1 스키마로 데이터 생성
    const v1 = new Dexie(name);
    v1.version(1).stores({
      cards: 'id, orderIndex, category, difficulty',
      schedules: 'cardId, dueStep, lastReviewedStep',
      reviewLogs: 'id, cardId, stepAfter',
      meta: 'key',
    });
    await v1.table('cards').add({
      ...makeCard({ id: 'm1', word: '  padded  ' }),
      tags: undefined,
    });
    await v1.table('meta').put({ key: 'studyStep', value: 7 });
    v1.close();

    // 앱 스키마(v3)로 열기 → 마이그레이션 실행
    const db2 = createDatabase(name);
    try {
      const card = await db2.cards.get('m1');
      expect(card).toBeDefined();
      expect(card?.word).toBe('padded'); // upgrade에서 trim
      expect(card?.tags).toEqual([]); // 누락 태그 보정
      expect(await getMeta(db2, META_KEYS.studyStep, 0)).toBe(7); // 학습 상태 보존
      expect(db2.verno).toBe(3);
    } finally {
      await db2.delete();
    }
  });

  it('v2 schedule/log가 v3 업그레이드 후 FSRS로 변환된다', async () => {
    const name = uniqueDbName();
    const old = new Dexie(name);
    old.version(2).stores({
      cards: 'id, orderIndex, category, difficulty, *tags',
      schedules: 'cardId, dueStep, lastReviewedStep',
      reviewLogs: 'id, cardId, stepAfter',
      meta: 'key',
    });
    await old.table('cards').add(makeCard({ id: 'm2' }));
    await old.table('schedules').add({
      cardId: 'm2', dueStep: 41, intervalSteps: 40, repetitions: 1,
      lapses: 0, ease: 2.3, lastRating: 'good', lastReviewedStep: 1,
      firstSeenStep: 1,
    });
    await old.table('reviewLogs').add({
      id: 'm2-log', cardId: 'm2', stepBefore: 0, stepAfter: 1,
      rating: 'good', intervalBefore: 0, intervalAfter: 40,
      schedulerVersion: 2, reviewedAt: '2026-01-01T00:00:00.000Z',
    });
    await old.table('meta').put({ key: 'studyStep', value: 1 });
    old.close();

    const upgraded = createDatabase(name);
    try {
      await upgraded.open();
      expect(await getMeta(upgraded, META_KEYS.fsrsMigrationPending, false)).toBe(true);
      await migrateLegacySchedulesToFsrs(upgraded);
      expect(await upgraded.schedules.get('m2')).toMatchObject({
        algorithm: 'fsrs-6', lastRating: 'good', state: 'review',
      });
      expect(await upgraded.reviewLogs.count()).toBe(1);
      expect(await getMeta(upgraded, META_KEYS.studyStep, 0)).toBe(1);
    } finally {
      await upgraded.delete();
    }
  });

  it('v2 schedule이 손실되고 로그만 남은 경우에도 v3가 복구를 예약한다', async () => {
    const name = uniqueDbName();
    const old = new Dexie(name);
    old.version(2).stores({
      cards: 'id, orderIndex, category, difficulty, *tags',
      schedules: 'cardId, dueStep, lastReviewedStep',
      reviewLogs: 'id, cardId, stepAfter',
      meta: 'key',
    });
    await old.table('cards').add(makeCard({ id: 'logs-only' }));
    await old.table('reviewLogs').add({
      id: 'logs-only-1', cardId: 'logs-only', stepBefore: 0, stepAfter: 1,
      rating: 'good', intervalBefore: 0, intervalAfter: 40,
      schedulerVersion: 2, reviewedAt: '2026-01-01T00:00:00.000Z',
    });
    old.close();

    const upgraded = createDatabase(name);
    try {
      await upgraded.open();
      expect(await getMeta(upgraded, META_KEYS.fsrsMigrationPending, false)).toBe(true);
      await migrateLegacySchedulesToFsrs(upgraded);
      expect(await upgraded.schedules.get('logs-only')).toMatchObject({
        algorithm: 'fsrs-6', lastRating: 'good',
      });
    } finally {
      await upgraded.delete();
    }
  });
});
