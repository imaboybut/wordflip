import type { Card, CardSchedule } from '../types';

let dbCounter = 0;

/** 테스트마다 격리된 DB 이름 */
export function uniqueDbName(): string {
  dbCounter += 1;
  return `wordflip-test-${Date.now()}-${dbCounter}`;
}

export function makeCard(overrides: Partial<Card> & { id: string }): Card {
  return {
    word: `word-${overrides.id}`,
    partOfSpeech: 'noun',
    koreanMeaning: `뜻-${overrides.id}`,
    koreanPronunciation: '발음',
    exampleSentence: `Example ${overrides.id}.`,
    exampleTranslation: `예문 ${overrides.id}.`,
    category: 'conversation',
    difficulty: 'A2',
    tags: ['test'],
    starred: false,
    orderIndex: 0,
    ...overrides,
  };
}

export function makeSchedule(
  overrides: Partial<CardSchedule> & { cardId: string },
): CardSchedule {
  return {
    dueStep: 0,
    intervalSteps: 40,
    repetitions: 1,
    lapses: 0,
    ease: 2.3,
    lastRating: 'good',
    lastReviewedStep: 0,
    firstSeenStep: 0,
    ...overrides,
  };
}
