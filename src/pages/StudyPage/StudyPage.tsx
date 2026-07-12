import { useEffect, useMemo } from 'react';
import type { Rating } from '../../types';
import { useAppState } from '../../stores/appStore';
import {
  advanceAfterReveal,
  markCurrentCardKnown,
  revealCurrentCardAsUnknown,
  setStudyMode,
  skipCard,
  undoLast,
} from '../../stores/appActions';
import { StudyCard } from '../../components/StudyCard/StudyCard';
import { SwipeCard } from '../../components/SwipeCard/SwipeCard';
import { rateCard } from '../../scheduler/stepScheduler';

export function StudyPage() {
  const state = useAppState();
  const {
    cards,
    schedules,
    studyStep,
    settings,
    mode,
    currentCardId,
    flipped,
    awaitingAdvance,
    isRating,
    canUndo,
  } = state;

  const card = currentCardId !== null ? cards.get(currentCardId) : undefined;

  // 데스크톱 접근성: 키보드 조작
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        // 카드에 포커스가 없어도 키보드로 같은 한-탭 흐름을 사용할 수 있다.
        if (e.target instanceof HTMLElement && e.target.closest('button')) return;
        e.preventDefault();
        if (awaitingAdvance) advanceAfterReveal();
        else if (!flipped) void revealCurrentCardAsUnknown();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [awaitingAdvance, flipped]);

  const stats = useMemo(() => {
    let starredCount = 0;
    for (const c of cards.values()) if (c.starred) starredCount += 1;
    return {
      total: cards.size,
      seen: schedules.size,
      starred: starredCount,
      steps: studyStep,
    };
  }, [cards, schedules, studyStep]);

  const previews = useMemo(() => {
    if (!settings.showDiagnostics || !card) return null;
    const prev = schedules.get(card.id) ?? null;
    const result: Record<Rating, number> = { again: 0, hard: 0, good: 0, easy: 0 };
    for (const r of ['again', 'hard', 'good', 'easy'] as const) {
      result[r] = rateCard(prev, card.id, r, studyStep + 1).intervalSteps;
    }
    return result;
  }, [settings.showDiagnostics, card, schedules, studyStep]);

  const emptyMessage = getEmptyMessage();

  const handleCardTap = () => {
    if (isRating) return;
    if (awaitingAdvance) {
      advanceAfterReveal();
    } else if (!flipped) {
      void revealCurrentCardAsUnknown();
    }
  };

  function getEmptyMessage(): string | null {
    if (card) return null;
    if (cards.size === 0) {
      return '단어가 없습니다. 데이터 탭에서 CSV를 가져오거나 샘플 데이터를 불러와 주세요.';
    }
    if (mode.type === 'starred') {
      return '별표 카드가 없습니다. 카드의 ☆ 버튼을 눌러 별표를 표시해 보세요.';
    }
    if (mode.type === 'search') {
      return `"${mode.query ?? ''}" 검색 결과가 없습니다.`;
    }
    return '표시할 카드가 없습니다.';
  }

  return (
    <div className="study-page">
      <header className="study-page__header">
        <div className="mode-tabs" role="tablist" aria-label="학습 모드">
          <button
            type="button"
            role="tab"
            aria-selected={mode.type === 'mix'}
            className={`mode-tab ${mode.type === 'mix' ? 'mode-tab--active' : ''}`}
            onClick={() => setStudyMode({ type: 'mix' })}
          >
            계속 학습
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode.type === 'browse'}
            className={`mode-tab ${mode.type === 'browse' ? 'mode-tab--active' : ''}`}
            onClick={() =>
              setStudyMode({ type: 'browse', browseIndex: 0, browseOrder: 'csv' })
            }
          >
            전체 둘러보기
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode.type === 'starred'}
            className={`mode-tab ${mode.type === 'starred' ? 'mode-tab--active' : ''}`}
            onClick={() => setStudyMode({ type: 'starred' })}
          >
            별표 학습
          </button>
        </div>
        {mode.type === 'search' && (
          <div className="search-mode-chip">
            검색 학습: “{mode.query}”
            <button
              type="button"
              className="search-mode-chip__close"
              aria-label="검색 학습 종료"
              onClick={() => setStudyMode({ type: 'mix' })}
            >
              ✕
            </button>
          </div>
        )}
        <p className="study-page__stats">
          전체 {stats.total.toLocaleString()} · 본 단어{' '}
          {stats.seen.toLocaleString()} · 별표 {stats.starred.toLocaleString()} ·
          총 넘김 {stats.steps.toLocaleString()}
        </p>
      </header>

      <main className="study-page__card-area">
        {card ? (
          <SwipeCard
            canRate={false}
            swipeEnabled={false}
            animationsEnabled={settings.animationsEnabled}
            onRate={() => {}}
            onTap={handleCardTap}
          >
            <StudyCard
              card={card}
              flipped={flipped}
              animationsEnabled={settings.animationsEnabled}
              onFlip={() => {
                /* 탭 처리는 SwipeCard의 onTap에서 담당. 클릭(키보드)만 여기로 온다 */
                handleCardTap();
              }}
            />
          </SwipeCard>
        ) : (
          <div className="study-page__empty">{emptyMessage}</div>
        )}
        {settings.showDiagnostics && card && (
          <DiagnosticsPanel cardId={card.id} />
        )}
      </main>

      <footer className="study-page__footer">
        {!flipped && card ? (
          <div
            className="rating-buttons rating-buttons--single"
            role="group"
            aria-label="카드 평가"
          >
            <button
              type="button"
              className="rating-button rating-button--good"
              disabled={isRating}
              onClick={() => void markCurrentCardKnown()}
              aria-label="아는 단어로 표시하고 다음 카드 보기"
            >
              <span className="rating-button__en">Good</span>
              <span className="rating-button__ko">알아요 · 다음 단어</span>
              {previews && (
                <span className="rating-button__preview">+{previews.good}</span>
              )}
            </button>
          </div>
        ) : (
          <p className="study-page__flip-hint" aria-hidden="true">
            {card
              ? awaitingAdvance
                ? '뜻을 확인한 뒤 카드를 한 번 더 누르면 다음 단어로 넘어갑니다'
                : '카드를 눌러 뜻을 확인하세요'
              : ''}
          </p>
        )}
        <div className="study-page__footer-row">
          <button
            type="button"
            className="btn btn--small"
            onClick={() => void undoLast()}
            disabled={!canUndo || isRating}
            aria-label="마지막 평가 되돌리기"
          >
            ↩ 되돌리기
          </button>
          {mode.type === 'browse' && (
            <>
              <button
                type="button"
                className="btn btn--small"
                aria-label="둘러보기 순서 변경"
                onClick={() =>
                  setStudyMode({
                    type: 'browse',
                    browseIndex: 0,
                    browseOrder: mode.browseOrder === 'random' ? 'csv' : 'random',
                  })
                }
              >
                {mode.browseOrder === 'random' ? '🔀 무작위' : '↕ 순서대로'}
              </button>
              <button type="button" className="btn btn--small" onClick={skipCard}>
                건너뛰기 →
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}

function DiagnosticsPanel({ cardId }: { cardId: string }) {
  const { schedules, studyStep, reviewStreak } = useAppState();
  const s = schedules.get(cardId);
  return (
    <div className="diagnostics">
      <code>
        step={studyStep} streak={reviewStreak}
        {s
          ? ` due=${s.dueStep} int=${s.intervalSteps} ease=${s.ease.toFixed(2)} rep=${s.repetitions} lapse=${s.lapses}`
          : ' (신규 카드)'}
      </code>
    </div>
  );
}
