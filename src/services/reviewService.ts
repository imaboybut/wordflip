import type {
  CardSchedule,
  Rating,
  RatingCounts,
  ReviewLog,
} from '../types';
import { EMPTY_RATING_COUNTS } from '../types';
import { rateCard } from '../scheduler/stepScheduler';
import { getMeta, setMeta, type WordFlipDB } from '../db/database';
import { META_KEYS } from '../db/schema';
import { uid } from '../utils/uid';

const MAX_RECENT_KEPT = 30;

export interface ReviewOutcome {
  schedule: CardSchedule;
  log: ReviewLog;
  studyStep: number;
  recentIds: string[];
  reviewStreak: number;
  ratingCounts: RatingCounts;
}

interface UndoSnapshot {
  logId: string;
  cardId: string;
  prevSchedule: CardSchedule | null;
  prevStudyStep: number;
  prevRecentIds: string[];
  prevReviewStreak: number;
  prevRatingCounts: RatingCounts;
}

export interface UndoOutcome {
  cardId: string;
  schedule: CardSchedule | null;
  studyStep: number;
  recentIds: string[];
  reviewStreak: number;
  ratingCounts: RatingCounts;
}

/** 같은 카드가 빠른 연속 터치로 두 번 평가되는 것을 막는 프로세스 내 잠금 */
let ratingInFlight = false;

export function isRatingInFlight(): boolean {
  return ratingInFlight;
}

/**
 * 평가 1회를 원자적으로 처리한다. 하나의 IndexedDB 트랜잭션 안에서
 * (1) studyStep 증가 (2) 스케줄 갱신 (3) 복습 로그 추가(append-only)
 * (4) 최근 카드 목록 갱신 (5) 통계 갱신이 모두 성공하거나 모두 취소된다.
 */
export async function applyRating(
  dbi: WordFlipDB,
  cardId: string,
  rating: Rating,
  wasDueReview: boolean,
): Promise<ReviewOutcome> {
  if (ratingInFlight) {
    throw new Error('이전 평가가 아직 처리 중입니다.');
  }
  ratingInFlight = true;
  try {
    return await dbi.transaction(
      'rw',
      [dbi.schedules, dbi.reviewLogs, dbi.meta],
      async () => {
        const stepBefore = await getMeta(dbi, META_KEYS.studyStep, 0);
        const stepAfter = stepBefore + 1;

        const prev = (await dbi.schedules.get(cardId)) ?? null;

        const schedule = rateCard(prev, cardId, rating, stepAfter);

        const log: ReviewLog = {
          id: uid(),
          cardId,
          stepBefore,
          stepAfter,
          rating,
          intervalBefore: prev?.intervalSteps ?? 0,
          intervalAfter: schedule.intervalSteps,
          reviewedAt: new Date().toISOString(),
        };

        const prevRecent = await getMeta<string[]>(dbi, META_KEYS.recentIds, []);
        const recentIds = [...prevRecent.filter((id) => id !== cardId), cardId].slice(
          -MAX_RECENT_KEPT,
        );

        const prevStreak = await getMeta(dbi, META_KEYS.reviewStreak, 0);
        const reviewStreak = wasDueReview ? prevStreak + 1 : 0;

        const prevCounts = await getMeta<RatingCounts>(
          dbi,
          META_KEYS.ratingCounts,
          EMPTY_RATING_COUNTS,
        );
        const ratingCounts = { ...prevCounts, [rating]: prevCounts[rating] + 1 };

        const undo: UndoSnapshot = {
          logId: log.id,
          cardId,
          prevSchedule: prev,
          prevStudyStep: stepBefore,
          prevRecentIds: prevRecent,
          prevReviewStreak: prevStreak,
          prevRatingCounts: prevCounts,
        };

        await Promise.all([
          setMeta(dbi, META_KEYS.studyStep, stepAfter),
          dbi.schedules.put(schedule),
          dbi.reviewLogs.add(log),
          setMeta(dbi, META_KEYS.recentIds, recentIds),
          setMeta(dbi, META_KEYS.reviewStreak, reviewStreak),
          setMeta(dbi, META_KEYS.ratingCounts, ratingCounts),
          setMeta(dbi, META_KEYS.lastUndo, undo),
        ]);

        return {
          schedule,
          log,
          studyStep: stepAfter,
          recentIds,
          reviewStreak,
          ratingCounts,
        };
      },
    );
  } finally {
    ratingInFlight = false;
  }
}

/** 마지막 평가 한 번 되돌리기 */
export async function undoLastReview(
  dbi: WordFlipDB,
): Promise<UndoOutcome | null> {
  return dbi.transaction(
    'rw',
    [dbi.schedules, dbi.reviewLogs, dbi.meta],
    async () => {
      const undo = await getMeta<UndoSnapshot | null>(dbi, META_KEYS.lastUndo, null);
      if (undo === null) return null;

      if (undo.prevSchedule === null) {
        await dbi.schedules.delete(undo.cardId);
      } else {
        await dbi.schedules.put(undo.prevSchedule);
      }
      await Promise.all([
        dbi.reviewLogs.delete(undo.logId),
        setMeta(dbi, META_KEYS.studyStep, undo.prevStudyStep),
        setMeta(dbi, META_KEYS.recentIds, undo.prevRecentIds),
        setMeta(dbi, META_KEYS.reviewStreak, undo.prevReviewStreak),
        setMeta(dbi, META_KEYS.ratingCounts, undo.prevRatingCounts),
        setMeta(dbi, META_KEYS.lastUndo, null),
      ]);

      return {
        cardId: undo.cardId,
        schedule: undo.prevSchedule,
        studyStep: undo.prevStudyStep,
        recentIds: undo.prevRecentIds,
        reviewStreak: undo.prevReviewStreak,
        ratingCounts: undo.prevRatingCounts,
      };
    },
  );
}

/**
 * append-only 복습 로그를 처음부터 재생하여 모든 카드 스케줄과 studyStep을
 * 다시 계산한다. 스케줄 상태가 손상됐을 때의 복구 수단.
 */
export async function rebuildSchedulesFromLogs(dbi: WordFlipDB): Promise<{
  studyStep: number;
  schedules: CardSchedule[];
}> {
  return dbi.transaction(
    'rw',
    [dbi.schedules, dbi.reviewLogs, dbi.meta],
    async () => {
      const logs = await dbi.reviewLogs.orderBy('stepAfter').toArray();
      const map = new Map<string, CardSchedule>();
      let step = 0;
      const counts = { ...EMPTY_RATING_COUNTS };
      for (const log of logs) {
        step += 1;
        const prev = map.get(log.cardId) ?? null;
        map.set(log.cardId, rateCard(prev, log.cardId, log.rating, step));
        counts[log.rating] += 1;
      }
      const schedules = [...map.values()];
      await dbi.schedules.clear();
      await dbi.schedules.bulkPut(schedules);
      await Promise.all([
        setMeta(dbi, META_KEYS.studyStep, step),
        setMeta(dbi, META_KEYS.ratingCounts, counts),
        setMeta(dbi, META_KEYS.lastUndo, null),
      ]);
      return { studyStep: step, schedules };
    },
  );
}
