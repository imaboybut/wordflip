import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, getMeta, type WordFlipDB } from '../db/database';
import { META_KEYS } from '../db/schema';
import { appStore } from '../stores/appStore';
import {
  flipCard,
  initApp,
  markCurrentCardKnown,
  rateCurrentCard,
  revealCurrentCardAsUnknown,
  setActiveDb,
  setStudyMode,
  toggleStar,
  undoLast,
} from '../stores/appActions';
import { makeCard, makeSchedule, uniqueDbName } from './helpers';

describe('FSRS 학습 흐름 (store 통합)', () => {
  let db: WordFlipDB;

  beforeEach(async () => {
    appStore.reset();
    db = createDatabase(uniqueDbName());
    await db.cards.bulkAdd([
      makeCard({ id: 'c1', word: 'alpha', orderIndex: 0 }),
      makeCard({ id: 'c2', word: 'beta', orderIndex: 1, starred: true }),
      makeCard({ id: 'c3', word: 'gamma', orderIndex: 2 }),
    ]);
    setActiveDb(db);
    await initApp();
  });

  afterEach(async () => {
    await db.delete();
    appStore.reset();
  });

  it('초기화 후 첫 카드가 CSV 순서로 선택된다', () => {
    expect(appStore.getState()).toMatchObject({
      status: 'ready', currentCardId: 'c1', flipped: false,
    });
  });

  it('새 번들 데이터 버전은 init에서 카드 내용을 갱신하고 현재 위치를 유지한다', async () => {
    const csv = [
      'id,word,part_of_speech,korean_meaning,korean_pronunciation,example_sentence,example_translation,category,difficulty,tags,starred',
      'c1,alpha,noun,갱신된 알파,알파,Alpha works.,알파가 작동한다.,conversation,A1,,false',
      'c2,beta,noun,베타,베타,Beta works.,베타가 작동한다.,conversation,A1,,true',
      'c3,gamma,noun,감마,감마,Gamma works.,감마가 작동한다.,conversation,A1,,false',
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(csv, { status: 200 })));
    await db.meta.put({ key: META_KEYS.bundledDataVersion, value: '' });
    try {
      appStore.reset();
      await initApp();
      expect(appStore.getState().cards.get('c1')).toMatchObject({
        koreanMeaning: '갱신된 알파',
      });
      expect(appStore.getState().currentCardId).toBe('c1');
      expect(await getMeta(db, META_KEYS.bundledDataVersion, '')).toBe(
        __WORDS_DATA_VERSION__,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('뒤집기 전에는 네 버튼 평가를 직접 호출해도 기록하지 않는다', async () => {
    await rateCurrentCard('good');
    expect(appStore.getState().studyStep).toBe(0);
    expect(await db.reviewLogs.count()).toBe(0);
  });

  it('답을 공개한 뒤 평가하면 FSRS 상태를 저장하고 다음 카드로 간다', async () => {
    flipCard();
    await rateCurrentCard('good');
    const state = appStore.getState();
    expect(state.currentCardId).toBe('c2');
    expect(state.schedules.get('c1')).toMatchObject({
      algorithm: 'fsrs-6', lastRating: 'good', state: 'review',
    });
  });

  it('앞면 Good은 아는 카드로 저장하고 즉시 다음 카드로 넘어간다', async () => {
    await markCurrentCardKnown();
    expect(appStore.getState()).toMatchObject({
      studyStep: 1, currentCardId: 'c2', flipped: false,
    });
    expect(appStore.getState().schedules.get('c1')?.lastRating).toBe('good');
  });

  it('카드 탭은 답만 공개하고 평가 로그를 만들지 않는다', async () => {
    await revealCurrentCardAsUnknown();
    expect(appStore.getState()).toMatchObject({
      currentCardId: 'c1', flipped: true, studyStep: 0,
    });
    expect(appStore.getState().schedules.has('c1')).toBe(false);
    expect(await db.reviewLogs.count()).toBe(0);
  });

  it('답 공개 후 Again을 선택하면 다음 카드로 가며 30분 전 재등장하지 않는다', async () => {
    const before = Date.now();
    await revealCurrentCardAsUnknown();
    await rateCurrentCard('again');
    const schedule = appStore.getState().schedules.get('c1');
    expect(schedule?.dueAt).toBeGreaterThanOrEqual(before + 29 * 60_000);
    expect(appStore.getState().currentCardId).toBe('c2');

    await markCurrentCardKnown();
    expect(appStore.getState().currentCardId).toBe('c3');
    await markCurrentCardKnown();
    expect(appStore.getState().currentCardId).toBeNull();
  });

  it('due 복습 두 장 뒤에는 신규 한 장을 강제로 섞고 streak를 초기화한다', async () => {
    const dueAt = Date.now() - 60_000;
    const lastReviewAt = dueAt - 10 * 86_400_000;
    await db.schedules.bulkPut([
      makeSchedule({ cardId: 'c1', dueAt, lastReviewAt }),
      makeSchedule({ cardId: 'c2', dueAt, lastReviewAt }),
    ]);
    await db.meta.put({ key: META_KEYS.studySession, value: null });
    appStore.reset();
    await initApp();

    expect(appStore.getState().currentCardId).toBe('c1');
    flipCard();
    await rateCurrentCard('good');
    expect(appStore.getState()).toMatchObject({
      currentCardId: 'c2', reviewStreak: 1, currentWasDue: true,
    });

    flipCard();
    await rateCurrentCard('good');
    expect(appStore.getState()).toMatchObject({
      currentCardId: 'c3', reviewStreak: 2, currentWasDue: false,
    });

    await undoLast();
    expect(appStore.getState()).toMatchObject({
      currentCardId: 'c2', reviewStreak: 1, currentWasDue: true,
    });
    flipCard();
    await rateCurrentCard('good');
    expect(appStore.getState()).toMatchObject({
      currentCardId: 'c3', reviewStreak: 2, currentWasDue: false,
    });

    appStore.reset();
    await initApp();
    expect(appStore.getState()).toMatchObject({
      currentCardId: 'c3', reviewStreak: 2, currentWasDue: false,
    });

    await markCurrentCardKnown();
    expect(appStore.getState().reviewStreak).toBe(0);
  });

  it('빠른 연속 평가는 한 번만 기록된다', async () => {
    flipCard();
    await Promise.all([rateCurrentCard('good'), rateCurrentCard('good')]);
    expect(appStore.getState().studyStep).toBe(1);
    expect(await db.reviewLogs.count()).toBe(1);
  });

  it('되돌리기는 마지막 평가를 취소하고 그 카드 앞면으로 돌아온다', async () => {
    flipCard();
    await rateCurrentCard('easy');
    await undoLast();
    expect(appStore.getState()).toMatchObject({
      studyStep: 0,
      currentCardId: 'c1',
      flipped: false,
      canUndo: false,
    });
    expect(appStore.getState().schedules.has('c1')).toBe(false);
  });

  it('전체 둘러보기에서 되돌린 카드를 다시 평가해도 다음 카드를 건너뛰지 않는다', async () => {
    setStudyMode({ type: 'browse', browseIndex: 0, browseOrder: 'csv' });
    flipCard();
    await rateCurrentCard('good');
    expect(appStore.getState().currentCardId).toBe('c2');

    await undoLast();
    expect(appStore.getState().mode).toMatchObject({ type: 'browse', browseIndex: 0 });
    expect(appStore.getState().currentCardId).toBe('c1');

    flipCard();
    await rateCurrentCard('good');
    expect(appStore.getState().currentCardId).toBe('c2');
  });

  it('별표/검색 모드의 대상만 선택한다', () => {
    setStudyMode({ type: 'starred' });
    expect(appStore.getState().currentCardId).toBe('c2');
    setStudyMode({ type: 'search', query: 'gam' });
    expect(appStore.getState().currentCardId).toBe('c3');
    setStudyMode({ type: 'search', query: 'zzzz' });
    expect(appStore.getState().currentCardId).toBeNull();
  });

  it('별표 토글을 즉시 저장한다', async () => {
    await toggleStar('c1');
    expect(appStore.getState().cards.get('c1')?.starred).toBe(true);
    expect((await db.cards.get('c1'))?.starred).toBe(true);
  });

  it('평가 없는 답 공개 상태를 재시작 후 그대로 복원한다', async () => {
    await markCurrentCardKnown();
    await revealCurrentCardAsUnknown();
    expect(await db.reviewLogs.count()).toBe(1);

    appStore.reset();
    await initApp();
    expect(appStore.getState()).toMatchObject({
      currentCardId: 'c2', flipped: true, studyStep: 1,
    });
  });

  it('구버전 자동 Again 대기 세션은 중복 평가 방지를 위해 앞면으로 복원한다', async () => {
    await db.meta.put({
      key: META_KEYS.studySession,
      value: {
        mode: { type: 'mix' }, currentCardId: 'c1', flipped: true,
        currentWasDue: false, awaitingAdvance: true,
      },
    });
    appStore.reset();
    await initApp();
    expect(appStore.getState()).toMatchObject({
      currentCardId: 'c1', flipped: false, awaitingAdvance: false,
    });
    expect(await getMeta(db, META_KEYS.studyStep, 0)).toBe(0);
  });
});
