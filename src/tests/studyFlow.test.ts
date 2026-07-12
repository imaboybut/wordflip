import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, getMeta, type WordFlipDB } from '../db/database';
import { META_KEYS } from '../db/schema';
import { appStore } from '../stores/appStore';
import {
  advanceAfterReveal,
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
import { makeCard, uniqueDbName } from './helpers';

describe('학습 흐름 (store 통합)', () => {
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
    const s = appStore.getState();
    expect(s.status).toBe('ready');
    expect(s.currentCardId).toBe('c1');
    expect(s.flipped).toBe(false);
  });

  it('뒤집기 전에는 평가할 수 없다', async () => {
    await rateCurrentCard('good');
    expect(appStore.getState().studyStep).toBe(0);
    expect(await db.reviewLogs.count()).toBe(0);
  });

  it('뒤집은 뒤 평가하면 studyStep이 오르고 다음 카드로 넘어간다', async () => {
    flipCard();
    expect(appStore.getState().flipped).toBe(true);
    await rateCurrentCard('good');
    const s = appStore.getState();
    expect(s.studyStep).toBe(1);
    expect(s.currentCardId).toBe('c2');
    expect(s.flipped).toBe(false);
    expect(s.schedules.get('c1')?.intervalSteps).toBe(800);
  });

  it('앞면 Good은 아는 카드로 저장하고 즉시 다음 카드로 넘어간다', async () => {
    await markCurrentCardKnown();
    const s = appStore.getState();
    expect(s.studyStep).toBe(1);
    expect(s.currentCardId).toBe('c2');
    expect(s.flipped).toBe(false);
    expect(s.awaitingAdvance).toBe(false);
    expect(s.schedules.get('c1')).toMatchObject({
      lastRating: 'good',
      intervalSteps: 800,
    });
  });

  it('앞면 탭은 모름을 저장하고 뜻을 유지하며, 다음 탭에서 이동한다', async () => {
    await revealCurrentCardAsUnknown();
    let s = appStore.getState();
    expect(s.studyStep).toBe(1);
    expect(s.currentCardId).toBe('c1');
    expect(s.flipped).toBe(true);
    expect(s.awaitingAdvance).toBe(true);
    expect(s.schedules.get('c1')).toMatchObject({
      lastRating: 'again',
      intervalSteps: 3,
      lapses: 1,
    });

    advanceAfterReveal();
    s = appStore.getState();
    expect(s.currentCardId).toBe('c2');
    expect(s.flipped).toBe(false);
    expect(s.awaitingAdvance).toBe(false);
  });

  it('뜻을 공개한 상태에서 다시 모름 처리를 호출해도 중복 기록하지 않는다', async () => {
    await revealCurrentCardAsUnknown();
    await revealCurrentCardAsUnknown();
    expect(appStore.getState().studyStep).toBe(1);
    expect(await db.reviewLogs.count()).toBe(1);
  });

  it('빠른 연속 호출은 한 번만 평가된다 (중복 평가 방지)', async () => {
    flipCard();
    const p1 = rateCurrentCard('good');
    const p2 = rateCurrentCard('good');
    await Promise.all([p1, p2]);
    expect(appStore.getState().studyStep).toBe(1);
    expect(await db.reviewLogs.count()).toBe(1);
  });

  it('되돌리기: 마지막 평가가 취소되고 해당 카드로 돌아온다', async () => {
    flipCard();
    await rateCurrentCard('easy');
    expect(appStore.getState().studyStep).toBe(1);

    await undoLast();
    const s = appStore.getState();
    expect(s.studyStep).toBe(0);
    expect(s.currentCardId).toBe('c1');
    expect(s.schedules.has('c1')).toBe(false);
    expect(s.flipped).toBe(false);
    expect(s.awaitingAdvance).toBe(false);
    expect(s.canUndo).toBe(false);
  });

  it('별표 모드에서는 별표 카드만 나온다', () => {
    setStudyMode({ type: 'starred' });
    expect(appStore.getState().currentCardId).toBe('c2');
  });

  it('검색 모드에서는 검색 결과 밖 카드가 나오지 않는다', () => {
    setStudyMode({ type: 'search', query: 'gam' });
    expect(appStore.getState().currentCardId).toBe('c3');
  });

  it('검색 결과가 없으면 카드가 null이다', () => {
    setStudyMode({ type: 'search', query: 'zzzz' });
    expect(appStore.getState().currentCardId).toBeNull();
  });

  it('평가 저장 중에는 모드를 바꾸지 않는다', () => {
    appStore.setState({ isRating: true });
    setStudyMode({ type: 'starred' });
    expect(appStore.getState().mode).toEqual({ type: 'mix' });
    appStore.setState({ isRating: false });
  });

  it('별표 토글이 즉시 저장된다', async () => {
    await toggleStar('c1');
    expect(appStore.getState().cards.get('c1')?.starred).toBe(true);
    expect((await db.cards.get('c1'))?.starred).toBe(true);
  });

  it('세션이 저장되어 재시작 후에도 학습 위치가 복원된다', async () => {
    await markCurrentCardKnown(); // c1 평가 → c2 표시
    await revealCurrentCardAsUnknown(); // c2 모름 → 뜻을 본 채 다음 탭 대기
    const before = appStore.getState().currentCardId;

    const session = await getMeta(db, META_KEYS.studySession, null);
    expect(session).not.toBeNull();

    // 앱 재시작 시뮬레이션
    appStore.reset();
    await initApp();
    const s = appStore.getState();
    expect(s.currentCardId).toBe(before);
    expect(s.flipped).toBe(true);
    expect(s.awaitingAdvance).toBe(true);
    expect(s.studyStep).toBe(2);
  });

  it('구버전의 단순 뒤집기 세션은 평가되지 않은 앞면으로 안전하게 복원한다', async () => {
    await db.meta.put({
      key: META_KEYS.studySession,
      value: {
        mode: { type: 'mix' },
        currentCardId: 'c1',
        flipped: true,
        currentWasDue: false,
      },
    });

    appStore.reset();
    await initApp();
    expect(appStore.getState()).toMatchObject({
      currentCardId: 'c1',
      flipped: false,
      awaitingAdvance: false,
    });
  });
});
