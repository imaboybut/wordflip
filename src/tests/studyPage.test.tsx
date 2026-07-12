import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudyPage } from '../pages/StudyPage/StudyPage';
import { createDatabase, type WordFlipDB } from '../db/database';
import { appStore } from '../stores/appStore';
import { initApp, setActiveDb } from '../stores/appActions';
import { makeCard, uniqueDbName } from './helpers';

describe('단순 탭 학습 화면', () => {
  let db: WordFlipDB;

  beforeEach(async () => {
    appStore.reset();
    db = createDatabase(uniqueDbName());
    await db.cards.bulkAdd([
      makeCard({ id: 'c1', word: 'alpha', orderIndex: 0 }),
      makeCard({ id: 'c2', word: 'beta', orderIndex: 1 }),
      makeCard({ id: 'c3', word: 'gamma', orderIndex: 2 }),
    ]);
    setActiveDb(db);
    await initApp();
  });

  afterEach(async () => {
    await db.delete();
    appStore.reset();
  });

  it('앞면에는 Good 하나만 보이고 누르면 바로 다음 카드로 이동한다', async () => {
    const user = userEvent.setup();
    render(<StudyPage />);

    expect(
      screen.getByRole('button', {
        name: '아는 단어로 표시하고 다음 카드 보기',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Again')).not.toBeInTheDocument();
    expect(screen.queryByText('Hard')).not.toBeInTheDocument();
    expect(screen.queryByText('Easy')).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {
        name: '아는 단어로 표시하고 다음 카드 보기',
      }),
    );

    await waitFor(() => expect(appStore.getState().currentCardId).toBe('c2'));
    expect(appStore.getState().schedules.get('c1')?.lastRating).toBe('good');
  });

  it('카드 탭은 평가 없이 뜻을 공개하고 네 FSRS 버튼을 표시한다', async () => {
    const user = userEvent.setup();
    render(<StudyPage />);
    const card = screen.getByTestId('study-card');

    await user.click(card);
    await waitFor(() => expect(appStore.getState().flipped).toBe(true));
    expect(appStore.getState()).toMatchObject({
      currentCardId: 'c1',
      flipped: true,
      studyStep: 0,
    });
    expect(appStore.getState().schedules.has('c1')).toBe(false);
    expect(await db.reviewLogs.count()).toBe(0);
    expect(screen.getByText('Again')).toBeInTheDocument();
    expect(screen.getByText('Hard')).toBeInTheDocument();
    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(screen.getByText('Easy')).toBeInTheDocument();

    await user.click(screen.getByText('Again'));
    await waitFor(() => expect(appStore.getState()).toMatchObject({
      currentCardId: 'c2',
      flipped: false,
      studyStep: 1,
    }));
    expect(appStore.getState().schedules.get('c1')?.lastRating).toBe('again');
  });
});
