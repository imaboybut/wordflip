import { useEffect, useMemo } from 'react';
import type { Rating } from '../../types';
import { useAppState } from '../../stores/appStore';
import {
  advanceToNextCard,
  markCurrentCardKnown,
  rateCurrentCard,
  revealCurrentCardAsUnknown,
  setStudyMode,
  skipCard,
  undoLast,
} from '../../stores/appActions';
import { StudyCard } from '../../components/StudyCard/StudyCard';
import { SwipeCard } from '../../components/SwipeCard/SwipeCard';
import { RatingButtons } from '../../components/RatingButtons/RatingButtons';
import { createFsrsAdapter } from '../../scheduler/fsrsAdapter';

export function StudyPage() {
  const state = useAppState();
  const {
    cards,
    schedules,
    difficultIds,
    studyStep,
    settings,
    mode,
    currentCardId,
    flipped,
    isRating,
    canUndo,
    nextDueAt,
    nextReviewStep,
  } = state;
  const card = currentCardId !== null ? cards.get(currentCardId) : undefined;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.target.closest('button')) return;
      }
      if ((e.key === ' ' || e.key === 'Enter') && !flipped) {
        e.preventDefault();
        void revealCurrentCardAsUnknown();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flipped]);

  // due 시각이 되는 순간과 PWA가 다시 활성화되는 순간 큐를 다시 확인한다.
  useEffect(() => {
    if (card || mode.type === 'browse') return;
    const refresh = () => {
      if (document.visibilityState !== 'hidden') advanceToNextCard();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    let timer: number | undefined;
    if (nextDueAt !== null) {
      const armTimer = () => {
        const remaining = nextDueAt - Date.now();
        if (remaining <= 0) {
          refresh();
          return;
        }
        // setTimeout 최대 범위(약 24.9일)보다 먼 일정은 같은 effect 안에서
        // 여러 번 이어 예약한다.
        timer = window.setTimeout(
          armTimer,
          Math.min(Math.max(remaining + 50, 50), 2_147_483_647),
        );
      };
      armTimer();
    }
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [card, mode.type, nextDueAt]);

  const stats = useMemo(() => {
    let starredCount = 0;
    for (const c of cards.values()) if (c.starred) starredCount += 1;
    let difficultCount = 0;
    for (const id of difficultIds) if (cards.has(id)) difficultCount += 1;
    return {
      total: cards.size,
      seen: schedules.size,
      starred: starredCount,
      difficult: difficultCount,
    };
  }, [cards, schedules, difficultIds]);

  const previews = useMemo(() => {
    if (!settings.showDiagnostics || !card) return null;
    const now = Date.now();
    const adapter = createFsrsAdapter(settings.desiredRetention, { enableFuzz: false });
    const preview = adapter.preview(schedules.get(card.id) ?? null, now);
    return Object.fromEntries(
      (['again', 'hard', 'good', 'easy'] as const).map((rating) => [
        rating,
        formatInterval(preview[rating].card.dueAt - now),
      ]),
    ) as Record<Rating, string>;
  }, [settings.showDiagnostics, settings.desiredRetention, card, schedules]);

  const handleCardTap = () => {
    if (!isRating && !flipped) void revealCurrentCardAsUnknown();
  };

  const emptyMessage = getEmptyMessage({
    hasCard: card !== undefined,
    cardsSize: cards.size,
    difficultCount: stats.difficult,
    mode,
    nextDueAt,
    nextReviewStep,
    studyStep,
  });

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
            aria-selected={mode.type === 'difficult'}
            className={`mode-tab ${mode.type === 'difficult' ? 'mode-tab--active' : ''}`}
            onClick={() =>
              setStudyMode({ type: 'difficult', browseIndex: 0, browseOrder: 'csv' })
            }
          >
            어려운 단어
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
          전체 {stats.total.toLocaleString()} · 본 단어 {stats.seen.toLocaleString()} ·
          별표 {stats.starred.toLocaleString()} · 어려운{' '}
          {stats.difficult.toLocaleString()} · 총 평가 {studyStep.toLocaleString()}
        </p>
      </header>

      <main className="study-page__card-area">
        {card ? (
          <SwipeCard
            canRate={flipped}
            swipeEnabled={settings.swipeEnabled}
            animationsEnabled={settings.animationsEnabled}
            onRate={(rating) => void rateCurrentCard(rating)}
            onTap={handleCardTap}
          >
            <StudyCard
              card={card}
              flipped={flipped}
              animationsEnabled={settings.animationsEnabled}
              onFlip={handleCardTap}
            />
          </SwipeCard>
        ) : (
          <div className="study-page__empty">{emptyMessage}</div>
        )}
        {settings.showDiagnostics && card && <DiagnosticsPanel cardId={card.id} />}
      </main>

      <footer className="study-page__footer">
        {!flipped && card ? (
          <div
            className="rating-buttons rating-buttons--single"
            role="group"
            aria-label="빠른 카드 평가"
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
                <span className="rating-button__preview">{previews.good}</span>
              )}
            </button>
          </div>
        ) : flipped && card ? (
          <RatingButtons
            disabled={isRating}
            onRate={(rating) => void rateCurrentCard(rating)}
            previews={previews}
          />
        ) : (
          <p className="study-page__flip-hint" aria-hidden="true" />
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
  const { schedules, settings, studyStep } = useAppState();
  const schedule = schedules.get(cardId);
  if (!schedule) return <div className="diagnostics"><code>FSRS 신규 카드</code></div>;
  const retrievability = createFsrsAdapter(settings.desiredRetention, {
    enableFuzz: false,
  }).retrievability(schedule, Date.now());
  return (
    <div className="diagnostics">
      <code>
        FSRS-6 · D={schedule.difficulty.toFixed(2)} · S={schedule.stability.toFixed(2)}일
        {' · '}R={(retrievability * 100).toFixed(1)}% · due={formatDate(schedule.dueAt)}
        {' · '}gap={Math.max(0, schedule.minReviewStep - studyStep)}장
      </code>
    </div>
  );
}

function getEmptyMessage(input: {
  hasCard: boolean;
  cardsSize: number;
  difficultCount: number;
  mode: ReturnType<typeof useAppState>['mode'];
  nextDueAt: number | null;
  nextReviewStep: number | null;
  studyStep: number;
}): string | null {
  if (input.hasCard) return null;
  if (input.cardsSize === 0) {
    return '단어가 없습니다. 데이터 탭에서 CSV를 가져와 주세요.';
  }
  if (input.mode.type === 'difficult') {
    return input.difficultCount === 0
      ? '아직 어려운 단어가 없습니다. 학습 중 Again(모름)이나 Hard로 평가한 단어가 여기에 모입니다.'
      : '어려운 단어를 모두 보여드렸습니다.';
  }
  if (input.mode.type === 'starred' && input.nextDueAt === null && input.nextReviewStep === null) {
    return '별표 카드가 없거나 지금 복습할 별표 카드가 없습니다.';
  }
  if (input.mode.type === 'search' && input.nextDueAt === null && input.nextReviewStep === null) {
    return `“${input.mode.query ?? ''}” 검색 결과가 없거나 지금 복습할 카드가 없습니다.`;
  }
  if (input.nextReviewStep !== null && input.nextReviewStep > input.studyStep) {
    return `이 카드가 너무 빨리 반복되지 않도록 다른 카드를 ${input.nextReviewStep - input.studyStep}장 더 학습한 뒤 다시 보여드립니다.`;
  }
  if (input.nextDueAt !== null) {
    return `지금 복습할 카드는 없습니다. 다음 복습: ${formatDate(input.nextDueAt)}`;
  }
  return '현재 모드의 학습을 마쳤습니다.';
}

function formatInterval(milliseconds: number): string {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간`;
  return `${Math.round(hours / 24)}일`;
}

function formatDate(timestamp: number): string {
  const diff = timestamp - Date.now();
  if (diff > 0 && diff < 86_400_000) return `약 ${formatInterval(diff)} 후`;
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}
