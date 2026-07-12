import type {
  RatingCounts,
  SeedReport,
  Settings,
  StudyMode,
} from '../types';

/** meta 테이블은 key-value 저장소다. */
export interface MetaEntry {
  key: string;
  value: unknown;
}

export const META_KEYS = {
  studyStep: 'studyStep',
  settings: 'settings',
  recentIds: 'recentIds',
  reviewStreak: 'reviewStreak',
  ratingCounts: 'ratingCounts',
  seedReport: 'seedReport',
  studySession: 'studySession',
  lastUndo: 'lastUndo',
  newOrderSeed: 'newOrderSeed',
} as const;

/** 화면이 꺼졌다 켜져도 학습 위치를 복원하기 위한 세션 상태 */
export interface StudySession {
  mode: StudyMode;
  currentCardId: string | null;
  flipped: boolean;
  currentWasDue: boolean;
}

export interface MetaShape {
  studyStep: number;
  settings: Settings;
  recentIds: string[];
  reviewStreak: number;
  ratingCounts: RatingCounts;
  seedReport: SeedReport | null;
  studySession: StudySession | null;
  newOrderSeed: number;
}
