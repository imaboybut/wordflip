export type Rating = 'again' | 'hard' | 'good' | 'easy';

export interface Card {
  id: string;
  word: string;
  partOfSpeech: string;
  koreanMeaning: string;
  koreanPronunciation: string;
  exampleSentence: string;
  exampleTranslation: string;
  category: string;
  difficulty: string;
  tags: string[];
  starred: boolean;
  /** CSV 원본 순서. 신규 카드 기본 제시 순서로 사용한다. */
  orderIndex: number;
}

export interface CardSchedule {
  cardId: string;
  /** 다음 복습 예정 시각 (UTC epoch milliseconds). */
  dueAt: number;
  /** 기억 안정성: 회상률이 90%로 내려가는 데 걸리는 일수. */
  stability: number;
  /** 카드별 난이도 (FSRS 범위 1–10). */
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: 'new' | 'learning' | 'review' | 'relearning';
  lastReviewAt: number | null;
  /** Again 카드의 너무 빠른 재등장을 막는 최소 누적 평가 횟수. */
  minReviewStep: number;
  lastRating: Rating | null;
  algorithm: 'fsrs-6';
}

/** v1/v2 백업과 IndexedDB 업그레이드에서만 읽는 옛 step 기반 상태. */
export interface LegacyCardSchedule {
  cardId: string;
  dueStep: number;
  intervalSteps: number;
  repetitions: number;
  lapses: number;
  ease: number;
  lastRating: Rating | null;
  lastReviewedStep: number | null;
  firstSeenStep: number | null;
}

export interface ReviewLog {
  id: string;
  cardId: string;
  stepBefore: number;
  stepAfter: number;
  rating: Rating;
  /** v1/v2에서는 step, v3에서는 예약 일수. */
  intervalBefore: number;
  intervalAfter: number;
  /** 없으면 최초 배포 스케줄러(v1) 기록으로 간주한다. */
  schedulerVersion?: 1 | 2 | 3;
  /** v3부터 로그 재생을 손실 없이 하기 위한 평가 직후 FSRS 상태. */
  scheduleAfter?: CardSchedule;
  /** 실제 경과시간을 계산하는 FSRS 복습 시각. */
  reviewedAt: string;
}

export type ThemeSetting = 'system' | 'light' | 'dark';
export type NewCardOrder = 'csv' | 'random';

export interface Settings {
  theme: ThemeSetting;
  newCardOrder: NewCardOrder;
  swipeEnabled: boolean;
  ttsRate: number;
  ttsVoiceURI: string | null;
  animationsEnabled: boolean;
  avoidRecentCount: number;
  showDiagnostics: boolean;
  /** FSRS가 목표로 하는 회상 확률 (Anki 기본값 0.90). */
  desiredRetention: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  newCardOrder: 'csv',
  swipeEnabled: true,
  ttsRate: 1.0,
  ttsVoiceURI: null,
  animationsEnabled: true,
  avoidRecentCount: 5,
  showDiagnostics: false,
  desiredRetention: 0.9,
};

export type StudyModeType = 'mix' | 'browse' | 'starred' | 'search';

export interface StudyMode {
  type: StudyModeType;
  /** search 모드에서 사용하는 검색어 */
  query?: string;
  /** browse 모드의 진행 위치 */
  browseIndex?: number;
  /** browse 모드 순서 */
  browseOrder?: 'csv' | 'random';
}

export interface RatingCounts {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

export const EMPTY_RATING_COUNTS: RatingCounts = {
  again: 0,
  hard: 0,
  good: 0,
  easy: 0,
};

export interface SeedReport {
  imported: number;
  skipped: { row: number; reason: string }[];
  total: number;
  finishedAt: string;
}
