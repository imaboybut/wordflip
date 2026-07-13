import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWordsCsv } from '../services/csvService';
import { seedIfEmpty, syncBundledCards } from '../services/importService';
import { createDatabase, getMeta } from '../db/database';
import { META_KEYS } from '../db/schema';
import { makeCard, makeSchedule, uniqueDbName } from './helpers';
import type { ReviewLog } from '../types';

/**
 * public/data/words.csv 데이터 품질 회귀 테스트.
 * 배포 워크플로가 테스트를 통과해야만 배포하므로,
 * 손상된 단어 데이터가 커밋되면 여기서 차단된다.
 */
describe('words.csv 데이터 파일', () => {
  const csv = readFileSync(
    join(__dirname, '../../public/data/words.csv'),
    'utf8',
  );

  it('파싱 오류 없이 충분한 수의 카드가 로드된다', () => {
    const { cards, errors } = parseWordsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(cards.length).toBeGreaterThan(1000);
  });

  it('모든 카드에 필수 필드와 한국어 뜻/예문이 있다', () => {
    const { cards } = parseWordsCsv(csv);
    for (const c of cards) {
      expect(c.word.length).toBeGreaterThan(0);
      expect(/[가-힣]/.test(c.koreanMeaning)).toBe(true);
      expect(c.exampleSentence.length).toBeGreaterThan(0);
      expect(/[가-힣]/.test(c.exampleTranslation)).toBe(true);
    }
  });

  it('자동 생성 템플릿 예문이 남아 있지 않다', () => {
    expect(csv).not.toContain('I heard the word');
    expect(csv).not.toContain('일상 대화에서 들을 수 있으며');
  });

  it('필수 회화 표현(phrasal verb)이 포함되어 있다', () => {
    const { cards } = parseWordsCsv(csv);
    const words = new Set(cards.map((c) => c.word.toLowerCase()));
    for (const w of ['figure out', 'hang out', 'look forward to', 'make sense']) {
      expect(words.has(w)).toBe(true);
    }
  });

  it('첫 실행 시딩: 실데이터 전체가 IndexedDB에 들어가고, 재실행 시 중복 삽입되지 않는다', async () => {
    const db = createDatabase(uniqueDbName());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(csv, { status: 200 })),
    );
    try {
      const report = await seedIfEmpty(db, '/data/words.csv');
      expect(report).not.toBeNull();
      expect(report?.skipped ?? []).toHaveLength(0);
      const count = await db.cards.count();
      expect(count).toBe(report?.imported);
      expect(count).toBeGreaterThan(1000);

      // 두 번째 실행: 이미 데이터가 있으므로 아무것도 하지 않음
      const again = await seedIfEmpty(db, '/data/words.csv');
      expect(again).toBeNull();
      expect(await db.cards.count()).toBe(count);
    } finally {
      vi.unstubAllGlobals();
      await db.delete();
    }
  });

  it('새 번들 CSV는 기존 진도·별표·사용자 카드를 보존하며 한 번만 동기화한다', async () => {
    const db = createDatabase(uniqueDbName());
    const previousSchedule = makeSchedule({ cardId: '1' });
    const userCard = makeCard({ id: 'user-1', word: 'custom', orderIndex: 9000 });
    const previousLog: ReviewLog = {
      id: 'review-1',
      cardId: '1',
      stepBefore: 0,
      stepAfter: 1,
      rating: 'good',
      intervalBefore: 0,
      intervalAfter: previousSchedule.scheduledDays,
      schedulerVersion: 3,
      scheduleAfter: previousSchedule,
      reviewedAt: new Date(previousSchedule.lastReviewAt ?? Date.now()).toISOString(),
    };
    await db.cards.bulkAdd([
      makeCard({
        id: '1',
        word: 'alpha',
        partOfSpeech: 'wrong',
        koreanMeaning: '이전 뜻',
        starred: true,
        orderIndex: 77,
      }),
      userCard,
    ]);
    await db.schedules.put(previousSchedule);
    await db.reviewLogs.put(previousLog);
    const updateCsv = [
      'id,word,part_of_speech,korean_meaning,korean_pronunciation,example_sentence,example_translation,category,difficulty,tags,starred',
      '1,alpha,noun,새 뜻,알파,Alpha works.,알파가 작동한다.,conversation,A1,,false',
      '2,beta,noun,베타,베타,Beta works.,베타가 작동한다.,conversation,A1,,false',
      'seed-custom,custom,noun,사용자 중복,커스텀,Custom works.,커스텀이 작동한다.,conversation,A1,,false',
    ].join('\n');
    const fetchMock = vi.fn(async () => new Response(updateCsv, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const report = await syncBundledCards(db, '/data/words.csv', 'hash-v2');
      expect(report).toMatchObject({ imported: 2 });
      expect(report?.skipped).toHaveLength(1);
      expect(await db.cards.get('1')).toMatchObject({
        partOfSpeech: 'noun',
        koreanMeaning: '새 뜻',
        starred: true,
        orderIndex: 77,
      });
      expect(await db.cards.get('2')).toBeDefined();
      expect((await db.cards.get('2'))?.orderIndex).toBe(9001);
      expect(await db.cards.get('user-1')).toEqual(userCard);
      expect(await db.cards.get('seed-custom')).toBeUndefined();
      expect(await db.schedules.get('1')).toEqual(previousSchedule);
      expect(await db.reviewLogs.get('review-1')).toEqual(previousLog);
      expect(await getMeta(db, META_KEYS.bundledDataVersion, '')).toBe('hash-v2');

      const again = await syncBundledCards(db, '/data/words.csv', 'hash-v2');
      expect(again).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      await db.delete();
    }
  });

  it('기존 덱이 있으면 오프라인 동기화 실패가 앱 시작을 막지 않는다', async () => {
    const db = createDatabase(uniqueDbName());
    await db.cards.add(makeCard({ id: 'existing' }));
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    try {
      await expect(
        syncBundledCards(db, '/data/words.csv', 'new-hash'),
      ).resolves.toBeNull();
      expect(await db.cards.count()).toBe(1);
      expect(await getMeta(db, META_KEYS.bundledDataVersion, '')).toBe('');
    } finally {
      vi.unstubAllGlobals();
      await db.delete();
    }
  });

  it('번들 CSV 파싱 오류 시 기존 DB와 버전을 전혀 바꾸지 않는다', async () => {
    const db = createDatabase(uniqueDbName());
    const existing = makeCard({ id: 'existing', koreanMeaning: '기존 뜻' });
    await db.cards.add(existing);
    const brokenCsv = [
      'id,word,part_of_speech,korean_meaning,korean_pronunciation,example_sentence,example_translation,category,difficulty,tags,starred',
      '1,,noun,잘못된 행,발음,Example.,예문이다.,conversation,A1,,false',
    ].join('\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(brokenCsv, { status: 200 })),
    );
    try {
      await expect(
        syncBundledCards(db, '/data/words.csv', 'broken-hash'),
      ).resolves.toBeNull();
      expect(await db.cards.get('existing')).toEqual(existing);
      expect(await getMeta(db, META_KEYS.bundledDataVersion, '')).toBe('');
    } finally {
      vi.unstubAllGlobals();
      await db.delete();
    }
  });
});
