import { useSyncExternalStore } from 'react';
import type {
  Card,
  CardSchedule,
  RatingCounts,
  SeedReport,
  Settings,
  StudyMode,
} from '../types';
import { DEFAULT_SETTINGS, EMPTY_RATING_COUNTS } from '../types';

export type AppStatus = 'loading' | 'ready' | 'error';

export interface AppState {
  status: AppStatus;
  errorMessage: string | null;

  cards: Map<string, Card>;
  /** orderIndex 오름차순 카드 id */
  deckOrder: string[];
  schedules: Map<string, CardSchedule>;

  studyStep: number;
  recentIds: string[];
  reviewStreak: number;
  ratingCounts: RatingCounts;
  settings: Settings;
  newOrderSeed: number;

  mode: StudyMode;
  currentCardId: string | null;
  currentWasDue: boolean;
  flipped: boolean;
  /** v2 세션 호환용. FSRS 흐름에서는 항상 false다. */
  awaitingAdvance: boolean;
  /** 현재 모드에서 가장 이른 미래 복습 시각. */
  nextDueAt: number | null;
  /** 시간은 됐지만 무작위 최소 카드 간격이 남은 누적 평가 횟수. */
  nextReviewStep: number | null;
  isRating: boolean;
  canUndo: boolean;

  seedReport: SeedReport | null;
  toast: string | null;
}

export const initialAppState: AppState = {
  status: 'loading',
  errorMessage: null,
  cards: new Map(),
  deckOrder: [],
  schedules: new Map(),
  studyStep: 0,
  recentIds: [],
  reviewStreak: 0,
  ratingCounts: EMPTY_RATING_COUNTS,
  settings: DEFAULT_SETTINGS,
  newOrderSeed: 1,
  mode: { type: 'mix' },
  currentCardId: null,
  currentWasDue: false,
  flipped: false,
  awaitingAdvance: false,
  nextDueAt: null,
  nextReviewStep: null,
  isRating: false,
  canUndo: false,
  seedReport: null,
  toast: null,
};

type Listener = () => void;

class AppStore {
  private state: AppState = initialAppState;
  private listeners = new Set<Listener>();

  getState = (): AppState => this.state;

  setState = (partial: Partial<AppState>): void => {
    this.state = { ...this.state, ...partial };
    for (const l of this.listeners) l();
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** 테스트용 초기화 */
  reset = (): void => {
    this.state = initialAppState;
    for (const l of this.listeners) l();
  };
}

export const appStore = new AppStore();

export function useAppState(): AppState {
  return useSyncExternalStore(appStore.subscribe, appStore.getState, appStore.getState);
}
