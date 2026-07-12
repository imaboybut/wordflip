import Dexie, { type Table } from 'dexie';
import type { Card, CardSchedule, ReviewLog } from '../types';
import type { MetaEntry } from './schema';
import { applyMigrations } from './migrations';

export class WordFlipDB extends Dexie {
  cards!: Table<Card, string>;
  schedules!: Table<CardSchedule, string>;
  reviewLogs!: Table<ReviewLog, string>;
  meta!: Table<MetaEntry, string>;

  constructor(name = 'wordflip') {
    super(name);
    applyMigrations(this);
  }
}

/** 테스트에서 격리된 DB 인스턴스를 만들 수 있도록 팩토리를 노출한다. */
export function createDatabase(name?: string): WordFlipDB {
  return new WordFlipDB(name);
}

export const db = createDatabase();

/** meta 헬퍼 */
export async function getMeta<T>(
  dbi: WordFlipDB,
  key: string,
  fallback: T,
): Promise<T> {
  const entry = await dbi.meta.get(key);
  return entry === undefined ? fallback : (entry.value as T);
}

export async function setMeta(
  dbi: WordFlipDB,
  key: string,
  value: unknown,
): Promise<void> {
  await dbi.meta.put({ key, value });
}
