import type Dexie from 'dexie';
import type { Card } from '../types';

/**
 * IndexedDB 스키마 마이그레이션.
 * 새 버전을 추가할 때는 아래에 version(n)을 이어 붙인다.
 * 업그레이드 중에도 사용자 학습 데이터(schedules, reviewLogs, meta)는 보존된다.
 */
export function applyMigrations(db: Dexie): void {
  db.version(1).stores({
    cards: 'id, orderIndex, category, difficulty',
    schedules: 'cardId, dueStep, lastReviewedStep',
    reviewLogs: 'id, cardId, stepAfter',
    meta: 'key',
  });

  // v2: 태그 multiEntry 인덱스 추가 + 단어 앞뒤 공백 정규화
  db.version(2)
    .stores({
      cards: 'id, orderIndex, category, difficulty, *tags',
    })
    .upgrade(async (tx) => {
      await tx
        .table<Card, string>('cards')
        .toCollection()
        .modify((card) => {
          card.word = card.word.trim();
          if (!Array.isArray(card.tags)) card.tags = [];
        });
    });
}
