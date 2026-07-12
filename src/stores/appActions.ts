import type { Card, Rating, Settings, StudyMode } from '../types';
import { DEFAULT_SETTINGS, EMPTY_RATING_COUNTS } from '../types';
import { db, getMeta, setMeta, type WordFlipDB } from '../db/database';
import { META_KEYS, type StudySession } from '../db/schema';
import {
  seededShuffle,
  selectBrowseCard,
  selectNextCard,
} from '../queue/cardSelector';
import {
  applyRating,
  rebuildSchedulesFromLogs,
  undoLastReview,
} from '../services/reviewService';
import { seedIfEmpty, importCards, type ImportOptions } from '../services/importService';
import { parseWordsCsv } from '../services/csvService';
import { restoreBackup, wipeAllData } from '../services/backupService';
import { appStore, type AppState } from './appStore';

const { getState, setState } = appStore;

let activeDb: WordFlipDB = db;

/** 테스트에서 격리된 DB를 주입할 수 있게 한다. */
export function setActiveDb(dbi: WordFlipDB): void {
  activeDb = dbi;
}

export function getActiveDb(): WordFlipDB {
  return activeDb;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string): void {
  setState({ toast: message });
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), 3000);
}

// ---------- 초기화 ----------

export async function initApp(): Promise<void> {
  try {
    setState({ status: 'loading', errorMessage: null });

    const seedUrl = `${import.meta.env.BASE_URL}data/words.csv`;
    const seedReport = await seedIfEmpty(activeDb, seedUrl);

    const [cards, schedules] = await Promise.all([
      activeDb.cards.toArray(),
      activeDb.schedules.toArray(),
    ]);
    const [studyStep, recentIds, reviewStreak, ratingCounts, settings, savedReport, session, newOrderSeed, lastUndo] =
      await Promise.all([
        getMeta(activeDb, META_KEYS.studyStep, 0),
        getMeta<string[]>(activeDb, META_KEYS.recentIds, []),
        getMeta(activeDb, META_KEYS.reviewStreak, 0),
        getMeta(activeDb, META_KEYS.ratingCounts, EMPTY_RATING_COUNTS),
        getMeta<Settings>(activeDb, META_KEYS.settings, DEFAULT_SETTINGS),
        getMeta(activeDb, META_KEYS.seedReport, null),
        getMeta<StudySession | null>(activeDb, META_KEYS.studySession, null),
        getMeta(activeDb, META_KEYS.newOrderSeed, 0),
        getMeta(activeDb, META_KEYS.lastUndo, null),
      ]);

    let seed = newOrderSeed;
    if (seed === 0) {
      seed = (Math.floor(Math.random() * 2 ** 31) || 1) >>> 0;
      await setMeta(activeDb, META_KEYS.newOrderSeed, seed);
    }

    const cardMap = new Map(cards.map((c) => [c.id, c]));
    const deckOrder = cards
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((c) => c.id);

    setState({
      cards: cardMap,
      deckOrder,
      schedules: new Map(schedules.map((s) => [s.cardId, s])),
      studyStep,
      recentIds,
      reviewStreak,
      ratingCounts,
      settings: { ...DEFAULT_SETTINGS, ...settings },
      newOrderSeed: seed,
      seedReport: seedReport ?? savedReport,
      canUndo: lastUndo !== null,
    });

    // 화면이 꺼졌다 켜지거나 재실행돼도 이전 학습 위치를 복원
    if (
      session &&
      session.currentCardId !== null &&
      cardMap.has(session.currentCardId)
    ) {
      setState({
        mode: session.mode,
        currentCardId: session.currentCardId,
        // 이전 버전에서 단순히 뒤집어 둔 카드는 평가 여부가 불명확하다.
        // 새 흐름에서 저장한 대기 상태만 뒷면으로 안전하게 복원한다.
        flipped: session.awaitingAdvance === true,
        awaitingAdvance: session.awaitingAdvance === true,
        currentWasDue: session.currentWasDue,
        status: 'ready',
      });
    } else {
      setState({ status: 'ready' });
      advanceToNextCard();
    }
  } catch (err) {
    setState({
      status: 'error',
      errorMessage:
        err instanceof Error
          ? `앱을 시작하지 못했습니다: ${err.message}`
          : '앱을 시작하지 못했습니다. 새로고침해 주세요.',
    });
  }
}

// ---------- 카드 선택 ----------

function eligibleDeckIds(state: AppState, mode: StudyMode): string[] {
  const { deckOrder, cards } = state;
  switch (mode.type) {
    case 'starred':
      return deckOrder.filter((id) => cards.get(id)?.starred);
    case 'search': {
      const q = (mode.query ?? '').trim().toLowerCase();
      if (q === '') return [];
      return deckOrder.filter((id) => {
        const c = cards.get(id);
        if (!c) return false;
        return (
          c.word.toLowerCase().includes(q) ||
          c.koreanMeaning.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q))
        );
      });
    }
    default:
      return deckOrder;
  }
}

function newIdsFor(state: AppState, deckIds: string[]): string[] {
  const unseen = deckIds.filter((id) => !state.schedules.has(id));
  if (state.settings.newCardOrder === 'random') {
    return seededShuffle(unseen, state.newOrderSeed);
  }
  return unseen;
}

function persistSession(): void {
  const s = getState();
  const session: StudySession = {
    mode: s.mode,
    currentCardId: s.currentCardId,
    flipped: s.flipped,
    currentWasDue: s.currentWasDue,
    awaitingAdvance: s.awaitingAdvance,
  };
  void setMeta(activeDb, META_KEYS.studySession, session).catch(() => {
    // 세션 저장 실패는 학습 흐름을 막지 않는다
  });
}

/** 다음 카드를 골라 화면에 올린다. */
export function advanceToNextCard(): void {
  const state = getState();
  const deckIds = eligibleDeckIds(state, state.mode);

  if (state.mode.type === 'browse') {
    const order =
      state.mode.browseOrder === 'random'
        ? seededShuffle(deckIds, state.newOrderSeed)
        : deckIds;
    const { cardId } = selectBrowseCard(order, state.mode.browseIndex ?? 0);
    setState({
      currentCardId: cardId,
      flipped: false,
      awaitingAdvance: false,
      currentWasDue: false,
    });
    persistSession();
    return;
  }

  const result = selectNextCard({
    studyStep: state.studyStep,
    schedules: state.schedules,
    deckIds,
    newIds: newIdsFor(state, deckIds),
    recentIds: state.recentIds,
    avoidRecentCount: state.settings.avoidRecentCount,
    reviewStreak: state.reviewStreak,
    currentCardId: state.currentCardId,
  });

  setState({
    currentCardId: result.cardId,
    currentWasDue: result.isDueReview,
    flipped: false,
    awaitingAdvance: false,
  });
  persistSession();
}

export function flipCard(): void {
  const s = getState();
  if (s.currentCardId === null || s.isRating || s.awaitingAdvance) return;
  setState({ flipped: !s.flipped });
  persistSession();
}

/**
 * 앞면을 눌렀을 때 뜻을 공개하고 즉시 Again(모름)을 저장한다.
 * 다음 카드는 아직 보여주지 않고, 뒷면을 한 번 더 누를 때까지 기다린다.
 */
export async function revealCurrentCardAsUnknown(): Promise<void> {
  const s = getState();
  if (
    s.currentCardId === null ||
    s.flipped ||
    s.awaitingAdvance ||
    s.isRating
  ) {
    return;
  }
  setState({ flipped: true });
  await commitCurrentRating('again', { allowFront: true, advance: false });
}

/** 앞면의 Good 버튼: 안다고 저장하고 곧바로 다음 카드로 이동한다. */
export async function markCurrentCardKnown(): Promise<void> {
  const s = getState();
  if (
    s.currentCardId === null ||
    s.flipped ||
    s.awaitingAdvance ||
    s.isRating
  ) {
    return;
  }
  await commitCurrentRating('good', { allowFront: true, advance: true });
}

/** 모름 처리 후 공개된 뒷면에서 다음 카드로 이동한다. */
export function advanceAfterReveal(): void {
  const s = getState();
  if (!s.awaitingAdvance || s.isRating) return;
  if (s.mode.type === 'browse') {
    setState({
      mode: { ...s.mode, browseIndex: (s.mode.browseIndex ?? 0) + 1 },
    });
  }
  advanceToNextCard();
}

/** browse 모드에서 평가 없이 다음 카드로 */
export function skipCard(): void {
  const s = getState();
  if (s.mode.type !== 'browse' || s.isRating) return;
  const mode = { ...s.mode, browseIndex: (s.mode.browseIndex ?? 0) + 1 };
  setState({ mode });
  advanceToNextCard();
}

// ---------- 평가 ----------

export async function rateCurrentCard(rating: Rating): Promise<void> {
  await commitCurrentRating(rating, { allowFront: false, advance: true });
}

interface CommitRatingOptions {
  allowFront: boolean;
  advance: boolean;
}

async function commitCurrentRating(
  rating: Rating,
  options: CommitRatingOptions,
): Promise<void> {
  const s = getState();
  // 뒤집기 전 평가 불가 + 처리 중 잠금 (빠른 연속 터치 중복 평가 방지)
  if (
    s.currentCardId === null ||
    (!options.allowFront && !s.flipped) ||
    s.awaitingAdvance ||
    s.isRating
  ) {
    return;
  }
  const cardId = s.currentCardId;
  const sessionAfterRating: StudySession = options.advance
    ? {
        mode: s.mode,
        currentCardId: null,
        flipped: false,
        currentWasDue: false,
        awaitingAdvance: false,
      }
    : {
        mode: s.mode,
        currentCardId: cardId,
        flipped: true,
        currentWasDue: s.currentWasDue,
        awaitingAdvance: true,
      };

  setState({ isRating: true });
  try {
    const outcome = await applyRating(
      activeDb,
      cardId,
      rating,
      s.currentWasDue,
      { studySession: sessionAfterRating },
    );

    const schedules = new Map(s.schedules);
    schedules.set(cardId, outcome.schedule);

    setState({
      schedules,
      studyStep: outcome.studyStep,
      recentIds: outcome.recentIds,
      reviewStreak: outcome.reviewStreak,
      ratingCounts: outcome.ratingCounts,
      canUndo: true,
    });

    if (options.advance) {
      if (s.mode.type === 'browse') {
        const mode = { ...s.mode, browseIndex: (s.mode.browseIndex ?? 0) + 1 };
        setState({ mode });
      }
      advanceToNextCard();
    } else {
      setState({
        currentCardId: cardId,
        flipped: true,
        awaitingAdvance: true,
      });
      persistSession();
    }
  } catch (err) {
    if (!options.advance) {
      setState({ flipped: false, awaitingAdvance: false });
      persistSession();
    }
    showToast(
      err instanceof Error ? err.message : '평가를 저장하지 못했습니다.',
    );
  } finally {
    setState({ isRating: false });
  }
}

export async function undoLast(): Promise<void> {
  const s = getState();
  if (s.isRating || !s.canUndo) return;
  setState({ isRating: true });
  try {
    const outcome = await undoLastReview(activeDb, { studyMode: s.mode });
    if (outcome === null) {
      setState({ canUndo: false });
      return;
    }
    const schedules = new Map(getState().schedules);
    if (outcome.schedule === null) schedules.delete(outcome.cardId);
    else schedules.set(outcome.cardId, outcome.schedule);

    setState({
      schedules,
      studyStep: outcome.studyStep,
      recentIds: outcome.recentIds,
      reviewStreak: outcome.reviewStreak,
      ratingCounts: outcome.ratingCounts,
      canUndo: false,
      currentCardId: outcome.cardId,
      currentWasDue: false,
      flipped: false,
      awaitingAdvance: false,
    });
    persistSession();
    showToast('마지막 평가를 되돌렸습니다.');
  } catch (err) {
    showToast(err instanceof Error ? err.message : '되돌리기에 실패했습니다.');
  } finally {
    setState({ isRating: false });
  }
}

// ---------- 모드 ----------

export function setStudyMode(mode: StudyMode): void {
  if (getState().isRating) return;
  setState({
    mode,
    currentCardId: null,
    flipped: false,
    awaitingAdvance: false,
    currentWasDue: false,
  });
  advanceToNextCard();
}

// ---------- 별표 ----------

export async function toggleStar(cardId: string): Promise<void> {
  const s = getState();
  const card = s.cards.get(cardId);
  if (!card) return;
  const updated = { ...card, starred: !card.starred };
  const cards = new Map(s.cards);
  cards.set(cardId, updated);
  setState({ cards });
  try {
    await activeDb.cards.update(cardId, { starred: updated.starred });
  } catch {
    // 실패 시 롤백
    const rolled = new Map(getState().cards);
    rolled.set(cardId, card);
    setState({ cards: rolled });
    showToast('별표를 저장하지 못했습니다.');
  }
}

// ---------- 설정 ----------

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const settings = { ...getState().settings, ...patch };
  setState({ settings });
  try {
    await setMeta(activeDb, META_KEYS.settings, settings);
  } catch {
    showToast('설정을 저장하지 못했습니다.');
  }
}

// ---------- 카드 CRUD ----------

export async function upsertCard(card: Card): Promise<void> {
  await activeDb.cards.put(card);
  const cards = new Map(getState().cards);
  cards.set(card.id, card);
  const deckOrder = [...cards.values()]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((c) => c.id);
  setState({ cards, deckOrder });
}

export async function deleteCard(cardId: string): Promise<void> {
  await activeDb.transaction(
    'rw',
    [activeDb.cards, activeDb.schedules],
    async () => {
      await activeDb.cards.delete(cardId);
      await activeDb.schedules.delete(cardId);
    },
  );
  const s = getState();
  const cards = new Map(s.cards);
  cards.delete(cardId);
  const schedules = new Map(s.schedules);
  schedules.delete(cardId);
  setState({
    cards,
    schedules,
    deckOrder: s.deckOrder.filter((id) => id !== cardId),
  });
  if (s.currentCardId === cardId) advanceToNextCard();
}

// ---------- 데이터 관리 ----------

export async function importCsvText(
  text: string,
  options: ImportOptions,
): Promise<string> {
  const parsed = parseWordsCsv(text);
  const result = await importCards(activeDb, parsed, options);
  await reloadFromDb();
  const skippedNote =
    result.skipped.length > 0 ? `, 건너뜀 ${result.skipped.length}건` : '';
  return `가져오기 완료: 추가 ${result.added}개, 갱신 ${result.updated}개${skippedNote}`;
}

export async function restoreBackupJson(text: string): Promise<string> {
  const data: unknown = JSON.parse(text);
  const result = await restoreBackup(activeDb, data);
  await reloadFromDb();
  return `복원 완료: 카드 ${result.cards}개, 학습 기록 ${result.reviewLogs}건`;
}

export async function resetAllData(): Promise<void> {
  await wipeAllData(activeDb);
  appStore.reset();
  await initApp();
}

export async function rebuildFromLogs(): Promise<string> {
  const result = await rebuildSchedulesFromLogs(activeDb);
  await reloadFromDb();
  return `재계산 완료: 카드 ${result.schedules.length}개, studyStep ${result.studyStep}`;
}

async function reloadFromDb(): Promise<void> {
  const [cards, schedules] = await Promise.all([
    activeDb.cards.toArray(),
    activeDb.schedules.toArray(),
  ]);
  const [studyStep, recentIds, reviewStreak, ratingCounts, settings] =
    await Promise.all([
      getMeta(activeDb, META_KEYS.studyStep, 0),
      getMeta<string[]>(activeDb, META_KEYS.recentIds, []),
      getMeta(activeDb, META_KEYS.reviewStreak, 0),
      getMeta(activeDb, META_KEYS.ratingCounts, EMPTY_RATING_COUNTS),
      getMeta<Settings>(activeDb, META_KEYS.settings, DEFAULT_SETTINGS),
    ]);
  const cardMap = new Map(cards.map((c) => [c.id, c]));
  setState({
    cards: cardMap,
    deckOrder: cards
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((c) => c.id),
    schedules: new Map(schedules.map((s) => [s.cardId, s])),
    studyStep,
    recentIds,
    reviewStreak,
    ratingCounts,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    canUndo: false,
    currentCardId: null,
    flipped: false,
    awaitingAdvance: false,
  });
  advanceToNextCard();
}
