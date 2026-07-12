import type { CardSchedule } from '../types';

export interface SelectorContext {
  studyStep: number;
  /** 평가된 적 있는 카드들의 스케줄 (cardId → schedule) */
  schedules: ReadonlyMap<string, CardSchedule>;
  /** 현재 모드에서 학습 대상인 카드 id 목록 (덱 순서) */
  deckIds: readonly string[];
  /** 아직 한 번도 보지 않은 카드 id 목록 (제시 순서: CSV 또는 무작위) */
  newIds: readonly string[];
  /** 최근에 보여준 카드 id (오래된 것 → 최신 순) */
  recentIds: readonly string[];
  /** 최근 반복 방지 개수 (설정값, 기본 5) */
  avoidRecentCount: number;
  /** 직전까지 복습(due) 카드가 연속으로 나온 횟수 */
  reviewStreak: number;
  /** 지금 화면에 떠 있는 카드 (즉시 연속 등장 방지) */
  currentCardId: string | null;
}

export interface SelectionResult {
  cardId: string | null;
  /** due 복습 카드로 선택되었는지 (reviewStreak 계산용) */
  isDueReview: boolean;
  /** 한 번도 본 적 없는 신규 카드인지 */
  isNew: boolean;
}
