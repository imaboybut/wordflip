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
import { parseWordsCsv } from '../services/csvService';
import { makeCard, uniqueDbName } from './helpers';

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
    const backup = await exportBackup(db);
    expect(backup.cards).toHaveLength(2);
    expect(backup.schedules).toHaveLength(2);
    expect(backup.reviewLogs).toHaveLength(2);
    expect(backup.studyStep).toBe(2);

    const db2 = createDatabase(uniqueDbName());
    try {
      const result = await restoreBackup(db2, JSON.parse(JSON.stringify(backup)));
      expect(result).toEqual({ cards: 2, schedules: 2, reviewLogs: 2 });
      expect(await getMeta(db2, META_KEYS.studyStep, -1)).toBe(2);
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
    expect(preserved?.intervalSteps).toBe(800);
    expect(await db.reviewLogs.count()).toBe(1);
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
  it('v1 데이터가 v2로 업그레이드되어도 보존된다', async () => {
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

    // 앱 스키마(v2)로 열기 → 마이그레이션 실행
    const db2 = createDatabase(name);
    try {
      const card = await db2.cards.get('m1');
      expect(card).toBeDefined();
      expect(card?.word).toBe('padded'); // upgrade에서 trim
      expect(card?.tags).toEqual([]); // 누락 태그 보정
      expect(await getMeta(db2, META_KEYS.studyStep, 0)).toBe(7); // 학습 상태 보존
      expect(db2.verno).toBe(2);
    } finally {
      await db2.delete();
    }
  });
});
