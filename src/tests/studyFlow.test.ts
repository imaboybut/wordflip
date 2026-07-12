import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, getMeta, type WordFlipDB } from '../db/database';
import { META_KEYS } from '../db/schema';
import { appStore } from '../stores/appStore';
import {
  flipCard,
  initApp,
  rateCurrentCard,
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
    expect(s.schedules.get('c1')?.intervalSteps).toBe(40);
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

  it('별표 토글이 즉시 저장된다', async () => {
    await toggleStar('c1');
    expect(appStore.getState().cards.get('c1')?.starred).toBe(true);
    expect((await db.cards.get('c1'))?.starred).toBe(true);
  });

  it('세션이 저장되어 재시작 후에도 학습 위치가 복원된다', async () => {
    flipCard();
    await rateCurrentCard('good'); // c1 평가 → c2 표시
    flipCard(); // c2 뒤집은 상태
    const before = appStore.getState().currentCardId;

    const session = await getMeta(db, META_KEYS.studySession, null);
    expect(session).not.toBeNull();

    // 앱 재시작 시뮬레이션
    appStore.reset();
    await initApp();
    const s = appStore.getState();
    expect(s.currentCardId).toBe(before);
    expect(s.flipped).toBe(true);
    expect(s.studyStep).toBe(1);
  });
});
