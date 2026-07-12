import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWordsCsv } from '../services/csvService';
import { seedIfEmpty } from '../services/importService';
import { createDatabase } from '../db/database';
import { uniqueDbName } from './helpers';

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
});
