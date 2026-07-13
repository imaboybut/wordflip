import type {
  Card,
  CardSchedule,
  RatingCounts,
  ReviewLog,
  Settings,
} from '../types';
import { EMPTY_RATING_COUNTS, DEFAULT_SETTINGS } from '../types';
import { clampDesiredRetention } from '../scheduler/fsrsAdapter';
import {
  isFsrsSchedule,
  migrateLegacySchedulesToFsrs,
} from './reviewService';
import { getMeta, setMeta, type WordFlipDB } from '../db/database';
import { META_KEYS } from '../db/schema';

export interface BackupFile {
  app: 'wordflip';
  version: 2;
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

interface LegacyBackupFile extends Omit<BackupFile, 'version' | 'schedules'> {
  version: 1;
  schedules: unknown[];
}

type SupportedBackup = BackupFile | LegacyBackupFile;

/** 학습 상태 전체를 JSON으로 백업한다. */
export async function exportBackup(dbi: WordFlipDB): Promise<BackupFile> {
  const [cards, schedules, reviewLogs] = await Promise.all([
    dbi.cards.orderBy('orderIndex').toArray(),
    dbi.schedules.toArray(),
    dbi.reviewLogs.orderBy('stepAfter').toArray(),
  ]);
  const settings = normalizeSettings(
    await getMeta<Settings>(dbi, META_KEYS.settings, DEFAULT_SETTINGS),
  );
  return {
    app: 'wordflip',
    version: 2,
    exportedAt: new Date().toISOString(),
    studyStep: await getMeta(dbi, META_KEYS.studyStep, 0),
    settings,
    recentIds: await getMeta<string[]>(dbi, META_KEYS.recentIds, []),
    reviewStreak: 0,
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

export function validateBackup(data: unknown): SupportedBackup {
  if (typeof data !== 'object' || data === null) {
    throw new Error('백업 파일 형식이 올바르지 않습니다.');
  }
  const b = data as Partial<SupportedBackup>;
  if (b.app !== 'wordflip' || (b.version !== 1 && b.version !== 2)) {
    throw new Error('WordFlip 백업 파일이 아니거나 지원하지 않는 버전입니다.');
  }
  if (!Array.isArray(b.cards) || !Array.isArray(b.schedules) || !Array.isArray(b.reviewLogs)) {
    throw new Error('백업 파일에 필수 데이터가 없습니다.');
  }
  if (!isNonNegativeInteger(b.studyStep)) {
    throw new Error('백업 파일의 studyStep 값이 손상되었습니다.');
  }
  for (const card of b.cards) {
    if (typeof card?.id !== 'string' || typeof card?.word !== 'string') {
      throw new Error('백업 파일의 카드 데이터가 손상되었습니다.');
    }
  }
  for (const log of b.reviewLogs) {
    if (
      typeof log?.id !== 'string' ||
      typeof log?.cardId !== 'string' ||
      !isRating(log?.rating) ||
      typeof log?.reviewedAt !== 'string' ||
      !Number.isFinite(Date.parse(log.reviewedAt))
    ) {
      throw new Error('백업 파일의 복습 로그가 손상되었습니다.');
    }
  }
  if (b.version === 2 && !b.schedules.every(isFsrsSchedule)) {
    throw new Error('백업 파일의 FSRS 스케줄이 손상되었습니다.');
  }
  return b as SupportedBackup;
}

/** JSON 백업에서 전체 복원한다. v1 step 백업도 FSRS로 자동 변환한다. */
export async function restoreBackup(
  dbi: WordFlipDB,
  data: unknown,
): Promise<{ cards: number; schedules: number; reviewLogs: number }> {
  const backup = validateBackup(data);
  const settings = normalizeSettings(backup.settings);
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
        dbi.schedules.bulkAdd(backup.schedules as CardSchedule[]),
        dbi.reviewLogs.bulkAdd(backup.reviewLogs),
        setMeta(dbi, META_KEYS.studyStep, backup.studyStep),
        setMeta(dbi, META_KEYS.settings, settings),
        setMeta(dbi, META_KEYS.recentIds, backup.recentIds ?? []),
        setMeta(dbi, META_KEYS.reviewStreak, 0),
        setMeta(dbi, META_KEYS.ratingCounts, {
          ...EMPTY_RATING_COUNTS,
          ...backup.ratingCounts,
        }),
        setMeta(dbi, META_KEYS.lastUndo, null),
        setMeta(dbi, META_KEYS.studySession, null),
        setMeta(dbi, META_KEYS.fsrsMigrationPending, backup.version === 1),
        // 복원 파일이 현재 번들의 이전 카드 내용을 담았을 수 있어 다음 init에서
        // 내장 CSV를 비파괴 동기화하도록 한다.
        setMeta(dbi, META_KEYS.bundledDataVersion, ''),
      ]);
    },
  );

  if (backup.version === 1) await migrateLegacySchedulesToFsrs(dbi);
  return {
    cards: backup.cards.length,
    schedules: await dbi.schedules.count(),
    reviewLogs: backup.reviewLogs.length,
  };
}

/** 데이터베이스 전체 초기화 (호출 전 UI 확인 대화상자를 거친다) */
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

function normalizeSettings(settings: Partial<Settings> | null | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    desiredRetention: clampDesiredRetention(
      settings?.desiredRetention ?? DEFAULT_SETTINGS.desiredRetention,
    ),
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRating(value: unknown): boolean {
  return value === 'again' || value === 'hard' || value === 'good' || value === 'easy';
}
