import type { Card } from '../types';
import { getMeta, setMeta, type WordFlipDB } from '../db/database';
import { META_KEYS } from '../db/schema';
import { normalizeWord, parseWordsCsv, type ParsedCsv } from './csvService';
import type { SeedReport } from '../types';

export interface ImportOptions {
  /** merge: 기존 데이터에 병합 / replace: 전체 교체 */
  mode: 'merge' | 'replace';
  /** 같은 id 또는 같은 단어의 기존 복습 기록 보존 여부 */
  preserveProgress: boolean;
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: { row: number; reason: string }[];
  progressPreserved: number;
}

/**
 * CSV import 규칙:
 * - merge: 같은 id → 카드 내용 갱신(복습 기록 유지), 같은 단어(다른 id) → 건너뜀,
 *   그 외 → 새 카드 추가
 * - replace: 기존 카드 전체 삭제 후 새로 삽입.
 *   preserveProgress=true면 같은 id 또는 같은 단어였던 카드의 스케줄을 새 id로 이어붙인다.
 *   preserveProgress=false면 스케줄/로그/카운터까지 모두 초기화한다.
 */
export async function importCards(
  dbi: WordFlipDB,
  parsed: ParsedCsv,
  options: ImportOptions,
): Promise<ImportResult> {
  const skipped = [...parsed.errors];
  let added = 0;
  let updated = 0;
  let progressPreserved = 0;

  await dbi.transaction(
    'rw',
    [dbi.cards, dbi.schedules, dbi.reviewLogs, dbi.meta],
    async () => {
      const existing = await dbi.cards.toArray();
      const byId = new Map(existing.map((c) => [c.id, c]));
      const byWord = new Map(existing.map((c) => [normalizeWord(c.word), c]));

      if (options.mode === 'merge') {
        const maxOrder = existing.reduce((m, c) => Math.max(m, c.orderIndex), -1);
        let nextOrder = maxOrder + 1;
        const toPut: Card[] = [];
        parsed.cards.forEach((card, i) => {
          const prev = byId.get(card.id);
          if (prev) {
            toPut.push({ ...card, starred: card.starred || prev.starred, orderIndex: prev.orderIndex });
            updated += 1;
            return;
          }
          const sameWord = byWord.get(normalizeWord(card.word));
          if (sameWord) {
            skipped.push({
              row: i + 2,
              reason: `이미 같은 단어가 있어 건너뜀: "${card.word}" (기존 id ${sameWord.id})`,
            });
            return;
          }
          toPut.push({ ...card, orderIndex: nextOrder++ });
          added += 1;
        });
        await dbi.cards.bulkPut(toPut);
        return;
      }

      // replace 모드
      const schedules = await dbi.schedules.toArray();
      const reviewLogs = await dbi.reviewLogs.toArray();
      const scheduleByCardId = new Map(schedules.map((s) => [s.cardId, s]));

      await dbi.cards.clear();
      await dbi.schedules.clear();

      const newCards = parsed.cards.map((c, i) => ({ ...c, orderIndex: i }));
      await dbi.cards.bulkAdd(newCards);
      added = newCards.length;

      if (options.preserveProgress) {
        const preserved = [];
        const idMap = new Map<string, string>();
        for (const card of newCards) {
          // 같은 id 우선, 없으면 같은 단어였던 기존 카드의 기록을 승계
          const old =
            scheduleByCardId.get(card.id) ??
            (() => {
              const prevCard = byWord.get(normalizeWord(card.word));
              return prevCard ? scheduleByCardId.get(prevCard.id) : undefined;
            })();
          if (old) {
            preserved.push({ ...old, cardId: card.id });
            idMap.set(old.cardId, card.id);
          }
        }
        await dbi.schedules.bulkPut(preserved);
        // 단어가 같은데 id만 바뀐 경우 로그와 snapshot의 cardId도 함께 옮긴다.
        // 그렇지 않으면 이후 "로그로 재계산"에서 보존한 진도가 사라진다.
        const remappedLogs = reviewLogs
          .filter((log) => idMap.has(log.cardId))
          .map((log) => {
            const cardId = idMap.get(log.cardId) as string;
            return {
              ...log,
              cardId,
              scheduleAfter: log.scheduleAfter
                ? { ...log.scheduleAfter, cardId }
                : undefined,
            };
          });
        await dbi.reviewLogs.clear();
        if (remappedLogs.length > 0) await dbi.reviewLogs.bulkPut(remappedLogs);
        const counts = { again: 0, hard: 0, good: 0, easy: 0 };
        for (const log of remappedLogs) counts[log.rating] += 1;
        const previousRecent = await getMeta<string[]>(dbi, META_KEYS.recentIds, []);
        const recentIds = previousRecent
          .map((id) => idMap.get(id))
          .filter((id): id is string => id !== undefined);
        await Promise.all([
          setMeta(dbi, META_KEYS.recentIds, recentIds),
          setMeta(dbi, META_KEYS.reviewStreak, 0),
          setMeta(dbi, META_KEYS.ratingCounts, counts),
          setMeta(dbi, META_KEYS.lastUndo, null),
          setMeta(dbi, META_KEYS.studySession, null),
        ]);
        progressPreserved = preserved.length;
      } else {
        await dbi.reviewLogs.clear();
        await Promise.all([
          setMeta(dbi, META_KEYS.studyStep, 0),
          setMeta(dbi, META_KEYS.recentIds, []),
          setMeta(dbi, META_KEYS.reviewStreak, 0),
          setMeta(dbi, META_KEYS.ratingCounts, {
            again: 0,
            hard: 0,
            good: 0,
            easy: 0,
          }),
          setMeta(dbi, META_KEYS.lastUndo, null),
          setMeta(dbi, META_KEYS.studySession, null),
        ]);
      }
    },
  );

  return { added, updated, skipped, progressPreserved };
}

/**
 * 첫 실행 시에만 public/data/words.csv를 IndexedDB로 시딩한다.
 * 이미 카드가 있으면 아무것도 하지 않는다 (중복 삽입 방지).
 */
export async function seedIfEmpty(
  dbi: WordFlipDB,
  csvUrl: string,
): Promise<SeedReport | null> {
  const count = await dbi.cards.count();
  if (count > 0) return null;

  const res = await fetch(csvUrl);
  if (!res.ok) {
    throw new Error(`초기 단어 데이터를 불러오지 못했습니다 (HTTP ${res.status})`);
  }
  const text = await res.text();
  const parsed = parseWordsCsv(text);
  if (parsed.cards.length === 0) {
    throw new Error('초기 단어 데이터가 비어 있습니다.');
  }

  await dbi.transaction('rw', [dbi.cards, dbi.meta], async () => {
    await dbi.cards.bulkAdd(parsed.cards);
    const report: SeedReport = {
      imported: parsed.cards.length,
      skipped: parsed.errors,
      total: parsed.cards.length + parsed.errors.length,
      finishedAt: new Date().toISOString(),
    };
    await setMeta(dbi, META_KEYS.seedReport, report);
  });

  return getMeta<SeedReport | null>(dbi, META_KEYS.seedReport, null);
}
