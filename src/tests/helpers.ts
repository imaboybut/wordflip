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
    dueAt: Date.now() - 60_000,
    stability: 10,
    difficulty: 5,
    elapsedDays: 10,
    scheduledDays: 10,
    learningSteps: 0,
    reps: 1,
    lapses: 0,
    state: 'review',
    lastReviewAt: Date.now() - 10 * 86_400_000,
    minReviewStep: 0,
    lastRating: 'good',
    algorithm: 'fsrs-6',
    ...overrides,
  };
}
