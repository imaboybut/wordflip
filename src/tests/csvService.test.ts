import { describe, expect, it } from 'vitest';
import {
  exportCardsToCsv,
  parseWordsCsv,
} from '../services/csvService';
import { makeCard } from './helpers';

const HEADER =
  'id,word,part_of_speech,korean_meaning,korean_pronunciation,example_sentence,example_translation,category,difficulty,tags,starred';

describe('CSV 파싱', () => {
  it('따옴표와 쉼표가 포함된 필드를 올바르게 파싱한다', () => {
    const csv = [
      HEADER,
      `1,steadily,adverb,"꾸준히, 착실히",스테덜리,"My English, I hope, is improving ""steadily"".",내 영어 실력은 꾸준히 늘고 있다.,conversation,A2,progress|daily,false`,
    ].join('\n');
    const { cards, errors } = parseWordsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(cards).toHaveLength(1);
    expect(cards[0].koreanMeaning).toBe('꾸준히, 착실히');
    expect(cards[0].exampleSentence).toBe(
      'My English, I hope, is improving "steadily".',
    );
    expect(cards[0].tags).toEqual(['progress', 'daily']);
  });

  it('UTF-8 한국어와 BOM을 처리한다', () => {
    const csv =
      '﻿' +
      [HEADER, '1,hello,interjection,안녕하세요,헐로우,Hello there!,안녕!,conversation,A1,,true'].join(
        '\n',
      );
    const { cards, errors } = parseWordsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(cards[0].koreanMeaning).toBe('안녕하세요');
    expect(cards[0].starred).toBe(true);
  });

  it('빈 필수 필드는 행 번호와 이유를 기록한다', () => {
    const csv = [
      HEADER,
      '1,,noun,뜻,발음,ex,tr,conversation,A1,,false',
      '2,word2,noun,,발음,ex,tr,conversation,A1,,false',
      '3,word3,noun,뜻3,발음,ex,tr,conversation,A1,,false',
    ].join('\n');
    const { cards, errors } = parseWordsCsv(csv);
    expect(cards).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0].row).toBe(2);
    expect(errors[0].reason).toContain('word');
    expect(errors[1].row).toBe(3);
    expect(errors[1].reason).toContain('korean_meaning');
  });

  it('중복 ID를 감지한다', () => {
    const csv = [
      HEADER,
      '1,alpha,noun,뜻1,발음,ex,tr,conversation,A1,,false',
      '1,beta,noun,뜻2,발음,ex,tr,conversation,A1,,false',
    ].join('\n');
    const { cards, errors } = parseWordsCsv(csv);
    expect(cards).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toContain('중복 ID');
  });

  it('대소문자/공백만 다른 중복 단어를 감지한다', () => {
    const csv = [
      HEADER,
      '1,Alpha,noun,뜻1,발음,ex,tr,conversation,A1,,false',
      '2,  alpha ,noun,뜻2,발음,ex,tr,conversation,A1,,false',
    ].join('\n');
    const { cards, errors } = parseWordsCsv(csv);
    expect(cards).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toContain('중복 단어');
  });

  it('id가 없으면 자동 생성한다', () => {
    const csv = [HEADER, ',noid,noun,뜻,발음,ex,tr,conversation,A1,,false'].join(
      '\n',
    );
    const { cards } = parseWordsCsv(csv);
    expect(cards).toHaveLength(1);
    expect(cards[0].id.length).toBeGreaterThan(0);
  });
});

describe('CSV 내보내기', () => {
  it('내보낸 CSV를 다시 파싱하면 같은 데이터가 나온다 (round-trip)', () => {
    const cards = [
      makeCard({
        id: '1',
        word: 'tricky, word',
        koreanMeaning: '까다로운 "뜻"',
        tags: ['a', 'b'],
        starred: true,
      }),
      makeCard({ id: '2', word: 'simple', orderIndex: 1 }),
    ];
    const csv = exportCardsToCsv(cards);
    const { cards: reparsed, errors } = parseWordsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(reparsed).toHaveLength(2);
    expect(reparsed[0].word).toBe('tricky, word');
    expect(reparsed[0].koreanMeaning).toBe('까다로운 "뜻"');
    expect(reparsed[0].tags).toEqual(['a', 'b']);
    expect(reparsed[0].starred).toBe(true);
    expect(reparsed[1].starred).toBe(false);
  });
});
