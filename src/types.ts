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
  intervalBefore: number;
  intervalAfter: number;
  /** 없으면 최초 배포 스케줄러(v1) 기록으로 간주한다. */
  schedulerVersion?: 1 | 2;
  /** 기록 확인/백업용. 스케줄 계산에는 절대 사용하지 않는다. */
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
