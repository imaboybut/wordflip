import Papa from 'papaparse';
import type { Card } from '../types';
import { uid } from '../utils/uid';

export const CSV_HEADER = [
  'id',
  'word',
  'part_of_speech',
  'korean_meaning',
  'korean_pronunciation',
  'example_sentence',
  'example_translation',
  'category',
  'difficulty',
  'tags',
  'starred',
] as const;

export interface CsvRowError {
  row: number;
  reason: string;
}

export interface ParsedCsv {
  cards: Card[];
  errors: CsvRowError[];
}

export function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

/**
 * words.csv 파싱. 쉼표/따옴표가 포함될 수 있으므로 Papa Parse만 사용한다.
 * 잘못된 행은 행 번호와 이유를 기록하고 건너뛴다.
 */
export function parseWordsCsv(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.replace(/^﻿/, '').trim(),
  });

  const cards: Card[] = [];
  const errors: CsvRowError[] = [];
  const seenIds = new Set<string>();
  const seenWords = new Set<string>();

  result.data.forEach((row, i) => {
    const rowNum = i + 2; // 헤더가 1행
    const word = (row.word ?? '').trim();
    const meaning = (row.korean_meaning ?? '').trim();
    if (word === '') {
      errors.push({ row: rowNum, reason: '필수 필드(word)가 비어 있습니다.' });
      return;
    }
    if (meaning === '') {
      errors.push({
        row: rowNum,
        reason: `필수 필드(korean_meaning)가 비어 있습니다: "${word}"`,
      });
      return;
    }

    let id = (row.id ?? '').trim();
    if (id === '') id = uid();
    if (seenIds.has(id)) {
      errors.push({ row: rowNum, reason: `중복 ID입니다: ${id} ("${word}")` });
      return;
    }
    const norm = normalizeWord(word);
    if (seenWords.has(norm)) {
      errors.push({ row: rowNum, reason: `중복 단어입니다: "${word}"` });
      return;
    }
    seenIds.add(id);
    seenWords.add(norm);

    cards.push({
      id,
      word,
      partOfSpeech: (row.part_of_speech ?? '').trim(),
      koreanMeaning: meaning,
      koreanPronunciation: (row.korean_pronunciation ?? '').trim(),
      exampleSentence: (row.example_sentence ?? '').trim(),
      exampleTranslation: (row.example_translation ?? '').trim(),
      category: (row.category ?? '').trim(),
      difficulty: (row.difficulty ?? '').trim(),
      tags: (row.tags ?? '')
        .split('|')
        .map((t) => t.trim())
        .filter((t) => t !== ''),
      starred: (row.starred ?? '').trim().toLowerCase() === 'true',
      orderIndex: cards.length,
    });
  });

  return { cards, errors };
}

/** 카드 목록을 스키마 그대로 CSV 문자열로 내보낸다. */
export function exportCardsToCsv(cards: readonly Card[]): string {
  const rows = cards.map((c) => ({
    id: c.id,
    word: c.word,
    part_of_speech: c.partOfSpeech,
    korean_meaning: c.koreanMeaning,
    korean_pronunciation: c.koreanPronunciation,
    example_sentence: c.exampleSentence,
    example_translation: c.exampleTranslation,
    category: c.category,
    difficulty: c.difficulty,
    tags: c.tags.join('|'),
    starred: c.starred ? 'true' : 'false',
  }));
  return Papa.unparse(rows, { columns: [...CSV_HEADER], newline: '\n' });
}
