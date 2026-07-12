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

  // v3: step 기반 스케줄 인덱스를 실제 시각 기반 FSRS 인덱스로 교체한다.
  // Dexie 업그레이드에서는 기존 레코드와 로그를 그대로 보존하고, 앱 초기화 때
  // ts-fsrs를 로드한 뒤 reviewedAt 기록을 재생해 원자적으로 변환한다.
  db.version(3)
    .stores({
      cards: 'id, orderIndex, category, difficulty, *tags',
      schedules: 'cardId, dueAt, lastReviewAt, state',
      reviewLogs: 'id, cardId, stepAfter, reviewedAt',
      meta: 'key',
    })
    .upgrade(async (tx) => {
      const [scheduleCount, reviewLogCount] = await Promise.all([
        tx.table('schedules').count(),
        tx.table('reviewLogs').count(),
      ]);
      if (scheduleCount === 0 && reviewLogCount === 0) return;
      await Promise.all([
        tx.table('meta').put({ key: 'fsrsMigrationPending', value: true }),
        // 이전 버전의 undo/session에는 step 스케줄 snapshot 또는 이미 자동으로
        // 기록된 Again 상태가 들어 있어 새 UI에서 복원하면 중복 평가될 수 있다.
        tx.table('meta').put({ key: 'lastUndo', value: null }),
        tx.table('meta').put({ key: 'studySession', value: null }),
        tx.table('meta').put({ key: 'reviewStreak', value: 0 }),
      ]);
    });
}
