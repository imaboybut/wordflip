import type { CardSchedule } from '../types';

export interface SelectorContext {
  /** 현재 시각 (UTC epoch milliseconds). 테스트에서도 고정 시각을 주입한다. */
  nowMs: number;
  /** 평가 횟수 기반 최소 간격 gate. FSRS 날짜 계산에는 사용하지 않는다. */
  studyStep: number;
  /** 평가된 적 있는 카드들의 FSRS 스케줄 (cardId → schedule) */
  schedules: ReadonlyMap<string, CardSchedule>;
  /** 현재 모드에서 학습 대상인 카드 id 목록 (덱 순서) */
  deckIds: readonly string[];
  /** 아직 한 번도 평가하지 않은 카드 id 목록 (제시 순서) */
  newIds: readonly string[];
  /** 최근에 보여준 카드 id (오래된 것 → 최신 순) */
  recentIds: readonly string[];
  /** 최근 반복 방지 개수 (설정값, 기본 5) */
  avoidRecentCount: number;
  /** 지금 화면에 떠 있는 카드 (즉시 연속 등장 방지) */
  currentCardId: string | null;
  /** FSRS 목표 기억 유지율. 복습 카드의 회상 가능성 정렬에 사용한다. */
  desiredRetention: number;
}

export interface SelectionResult {
  cardId: string | null;
  /** 예정 시각이 지난 FSRS 카드로 선택되었는지 */
  isDueReview: boolean;
  /** 한 번도 평가한 적 없는 신규 카드인지 */
  isNew: boolean;
  /** 지금 보여줄 카드가 없을 때, 현재 덱에서 가장 이른 다음 복습 시각 */
  nextDueAt: number | null;
  /** 시각은 됐지만 최소 카드 간격이 남았을 때 가장 이른 평가 횟수 */
  nextReviewStep: number | null;
}
