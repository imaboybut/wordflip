import type { Card, CardSchedule, RatingCounts, ReviewLog } from '../types';
import { EMPTY_RATING_COUNTS, DEFAULT_SETTINGS, type Settings } from '../types';
import { getMeta, setMeta, type WordFlipDB } from '../db/database';
import { META_KEYS } from '../db/schema';

export interface BackupFile {
  app: 'wordflip';
  version: 1;
  exportedAt: string;
  studyStep: number;
  settings: Settings;
  recentIds: string[];
  reviewStreak: number;
  ratingCounts: RatingCounts;
  cards: Card[];
  schedules: CardSchedule[];
  reviewLogs: ReviewLog[];
}

/** 학습 상태 전체를 JSON으로 백업한다. */
export async function exportBackup(dbi: WordFlipDB): Promise<BackupFile> {
  const [cards, schedules, reviewLogs] = await Promise.all([
    dbi.cards.orderBy('orderIndex').toArray(),
    dbi.schedules.toArray(),
    dbi.reviewLogs.orderBy('stepAfter').toArray(),
  ]);
  return {
    app: 'wordflip',
    version: 1,
    exportedAt: new Date().toISOString(),
    studyStep: await getMeta(dbi, META_KEYS.studyStep, 0),
    settings: await getMeta(dbi, META_KEYS.settings, DEFAULT_SETTINGS),
    recentIds: await getMeta<string[]>(dbi, META_KEYS.recentIds, []),
    reviewStreak: await getMeta(dbi, META_KEYS.reviewStreak, 0),
    ratingCounts: await getMeta<RatingCounts>(
      dbi,
      META_KEYS.ratingCounts,
      EMPTY_RATING_COUNTS,
    ),
    cards,
    schedules,
    reviewLogs,
  };
}

export function validateBackup(data: unknown): BackupFile {
  if (typeof data !== 'object' || data === null) {
    throw new Error('백업 파일 형식이 올바르지 않습니다.');
  }
  const b = data as Partial<BackupFile>;
  if (b.app !== 'wordflip' || b.version !== 1) {
    throw new Error('WordFlip 백업 파일이 아니거나 지원하지 않는 버전입니다.');
  }
  if (!Array.isArray(b.cards) || !Array.isArray(b.schedules) || !Array.isArray(b.reviewLogs)) {
    throw new Error('백업 파일에 필수 데이터가 없습니다.');
  }
  if (typeof b.studyStep !== 'number' || !Number.isInteger(b.studyStep) || b.studyStep < 0) {
    throw new Error('백업 파일의 studyStep 값이 손상되었습니다.');
  }
  for (const c of b.cards) {
    if (typeof c?.id !== 'string' || typeof c?.word !== 'string') {
      throw new Error('백업 파일의 카드 데이터가 손상되었습니다.');
    }
  }
  return b as BackupFile;
}

/** JSON 백업에서 전체 복원한다. 기존 데이터는 모두 대체된다. */
export async function restoreBackup(
  dbi: WordFlipDB,
  data: unknown,
): Promise<{ cards: number; schedules: number; reviewLogs: number }> {
  const backup = validateBackup(data);
  await dbi.transaction(
    'rw',
    [dbi.cards, dbi.schedules, dbi.reviewLogs, dbi.meta],
    async () => {
      await Promise.all([
        dbi.cards.clear(),
        dbi.schedules.clear(),
        dbi.reviewLogs.clear(),
      ]);
      await Promise.all([
        dbi.cards.bulkAdd(backup.cards),
        dbi.schedules.bulkAdd(backup.schedules),
        dbi.reviewLogs.bulkAdd(backup.reviewLogs),
        setMeta(dbi, META_KEYS.studyStep, backup.studyStep),
        setMeta(dbi, META_KEYS.settings, {
          ...DEFAULT_SETTINGS,
          ...backup.settings,
        }),
        setMeta(dbi, META_KEYS.recentIds, backup.recentIds ?? []),
        setMeta(dbi, META_KEYS.reviewStreak, backup.reviewStreak ?? 0),
        setMeta(dbi, META_KEYS.ratingCounts, backup.ratingCounts ?? EMPTY_RATING_COUNTS),
        setMeta(dbi, META_KEYS.lastUndo, null),
        setMeta(dbi, META_KEYS.studySession, null),
      ]);
    },
  );
  return {
    cards: backup.cards.length,
    schedules: backup.schedules.length,
    reviewLogs: backup.reviewLogs.length,
  };
}

/** 데이터베이스 전체 초기화 (호출 전 UI에서 확인 대화상자를 거친다) */
export async function wipeAllData(dbi: WordFlipDB): Promise<void> {
  await dbi.transaction(
    'rw',
    [dbi.cards, dbi.schedules, dbi.reviewLogs, dbi.meta],
    async () => {
      await Promise.all([
        dbi.cards.clear(),
        dbi.schedules.clear(),
        dbi.reviewLogs.clear(),
        dbi.meta.clear(),
      ]);
    },
  );
}
