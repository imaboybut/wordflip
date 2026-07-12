import { useMemo, useState, type FormEvent } from 'react';
import type { Card } from '../../types';
import { useAppState } from '../../stores/appStore';
import {
  deleteCard,
  setStudyMode,
  showToast,
  upsertCard,
} from '../../stores/appActions';
import { StarButton } from '../../components/StarButton/StarButton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { uid } from '../../utils/uid';

const PAGE_SIZE = 50;

type SortKey = 'csv' | 'alpha' | 'starred' | 'recent';

interface Props {
  onGoStudy: () => void;
}

export function WordListPage({ onGoStudy }: Props) {
  const { cards, deckOrder, schedules } = useAppState();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [starredOnly, setStarredOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('csv');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Card | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Card | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const c of cards.values()) if (c.category) set.add(c.category);
    return [...set].sort();
  }, [cards]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = deckOrder
      .map((id) => cards.get(id))
      .filter((c): c is Card => c !== undefined);
    if (q !== '') {
      list = list.filter(
        (c) =>
          c.word.toLowerCase().includes(q) ||
          c.koreanMeaning.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (category !== 'all') list = list.filter((c) => c.category === category);
    if (starredOnly) list = list.filter((c) => c.starred);
    switch (sort) {
      case 'alpha':
        list = list.slice().sort((a, b) => a.word.localeCompare(b.word));
        break;
      case 'starred':
        list = list.slice().sort((a, b) => Number(b.starred) - Number(a.starred));
        break;
      case 'recent':
        list = list
          .slice()
          .sort(
            (a, b) =>
              (schedules.get(b.id)?.lastReviewAt ?? -1) -
              (schedules.get(a.id)?.lastReviewAt ?? -1),
          );
        break;
      default:
        break;
    }
    return list;
  }, [cards, deckOrder, schedules, query, category, starredOnly, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );

  const startSearchStudy = () => {
    const q = query.trim();
    if (q === '') {
      showToast('검색어를 입력해 주세요.');
      return;
    }
    setStudyMode({ type: 'search', query: q });
    onGoStudy();
  };

  return (
    <div className="list-page">
      <div className="list-page__controls">
        <input
          type="search"
          className="input"
          placeholder="단어·뜻·태그 검색"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          aria-label="단어 검색"
        />
        <div className="list-page__filter-row">
          <select
            className="input input--select"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(0);
            }}
            aria-label="카테고리 필터"
          >
            <option value="all">전체 카테고리</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            className="input input--select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="정렬"
          >
            <option value="csv">기본 순서</option>
            <option value="alpha">알파벳순</option>
            <option value="starred">별표 우선</option>
            <option value="recent">최근 학습순</option>
          </select>
          <button
            type="button"
            className={`btn btn--small ${starredOnly ? 'btn--primary' : ''}`}
            aria-pressed={starredOnly}
            onClick={() => {
              setStarredOnly((v) => !v);
              setPage(0);
            }}
          >
            ★ 별표만
          </button>
        </div>
        <div className="list-page__filter-row">
          <span className="list-page__count">
            {filtered.length.toLocaleString()}개
          </span>
          <button type="button" className="btn btn--small" onClick={() => setAdding(true)}>
            + 카드 추가
          </button>
          <button
            type="button"
            className="btn btn--small btn--primary"
            onClick={startSearchStudy}
            disabled={query.trim() === ''}
          >
            이 검색 결과로 학습
          </button>
        </div>
      </div>

      <ul className="word-list">
        {pageItems.map((c) => (
          <li key={c.id} className="word-row">
            <StarButton cardId={c.id} starred={c.starred} />
            <button
              type="button"
              className="word-row__main"
              onClick={() => setEditing(c)}
              aria-label={`${c.word} 편집`}
            >
              <span className="word-row__word" lang="en">
                {c.word}
              </span>
              <span className="word-row__meaning">{c.koreanMeaning}</span>
            </button>
            <button
              type="button"
              className="word-row__delete"
              aria-label={`${c.word} 삭제`}
              onClick={() => setDeleting(c)}
            >
              🗑
            </button>
          </li>
        ))}
        {pageItems.length === 0 && (
          <li className="word-list__empty">조건에 맞는 단어가 없습니다.</li>
        )}
      </ul>

      {pageCount > 1 && (
        <div className="pagination">
          <button
            type="button"
            className="btn btn--small"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            ← 이전
          </button>
          <span>
            {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            className="btn btn--small"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(safePage + 1)}
          >
            다음 →
          </button>
        </div>
      )}

      {(editing || adding) && (
        <CardFormDialog
          card={editing}
          onClose={() => {
            setEditing(null);
            setAdding(false);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="카드 삭제"
        confirmLabel="삭제"
        danger
        onConfirm={() => {
          if (deleting) {
            void deleteCard(deleting.id).then(() =>
              showToast(`"${deleting.word}" 카드를 삭제했습니다.`),
            );
          }
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      >
        <p>
          “{deleting?.word}” 카드와 해당 학습 기록을 삭제합니다. 되돌릴 수
          없습니다.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function CardFormDialog({
  card,
  onClose,
}: {
  card: Card | null;
  onClose: () => void;
}) {
  const { cards } = useAppState();
  const [form, setForm] = useState(() => ({
    word: card?.word ?? '',
    partOfSpeech: card?.partOfSpeech ?? '',
    koreanMeaning: card?.koreanMeaning ?? '',
    koreanPronunciation: card?.koreanPronunciation ?? '',
    exampleSentence: card?.exampleSentence ?? '',
    exampleTranslation: card?.exampleTranslation ?? '',
    category: card?.category ?? 'conversation',
    difficulty: card?.difficulty ?? 'B1',
    tags: card?.tags.join('|') ?? '',
  }));

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const word = form.word.trim();
    const meaning = form.koreanMeaning.trim();
    if (word === '' || meaning === '') {
      showToast('단어와 한국어 뜻은 필수입니다.');
      return;
    }
    let maxOrder = -1;
    for (const c of cards.values()) maxOrder = Math.max(maxOrder, c.orderIndex);
    const next: Card = {
      id: card?.id ?? uid(),
      word,
      partOfSpeech: form.partOfSpeech.trim(),
      koreanMeaning: meaning,
      koreanPronunciation: form.koreanPronunciation.trim(),
      exampleSentence: form.exampleSentence.trim(),
      exampleTranslation: form.exampleTranslation.trim(),
      category: form.category.trim(),
      difficulty: form.difficulty.trim(),
      tags: form.tags
        .split('|')
        .map((t) => t.trim())
        .filter((t) => t !== ''),
      starred: card?.starred ?? false,
      orderIndex: card?.orderIndex ?? maxOrder + 1,
    };
    void upsertCard(next).then(() => {
      showToast(card ? '카드를 수정했습니다.' : '카드를 추가했습니다.');
      onClose();
    });
  };

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <form
        className="dialog dialog--form"
        role="dialog"
        aria-modal="true"
        aria-label={card ? '카드 편집' : '카드 추가'}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2 className="dialog__title">{card ? '카드 편집' : '카드 추가'}</h2>
        <label className="field">
          <span>영어 단어 *</span>
          <input className="input" value={form.word} onChange={set('word')} required />
        </label>
        <label className="field">
          <span>품사</span>
          <input
            className="input"
            value={form.partOfSpeech}
            onChange={set('partOfSpeech')}
            placeholder="noun, verb, phrase..."
          />
        </label>
        <label className="field">
          <span>한국어 뜻 *</span>
          <input
            className="input"
            value={form.koreanMeaning}
            onChange={set('koreanMeaning')}
            required
          />
        </label>
        <label className="field">
          <span>한글 발음</span>
          <input
            className="input"
            value={form.koreanPronunciation}
            onChange={set('koreanPronunciation')}
          />
        </label>
        <label className="field">
          <span>영어 예문</span>
          <textarea
            className="input"
            rows={2}
            value={form.exampleSentence}
            onChange={set('exampleSentence')}
          />
        </label>
        <label className="field">
          <span>예문 번역</span>
          <textarea
            className="input"
            rows={2}
            value={form.exampleTranslation}
            onChange={set('exampleTranslation')}
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>카테고리</span>
            <input className="input" value={form.category} onChange={set('category')} />
          </label>
          <label className="field">
            <span>난이도</span>
            <input className="input" value={form.difficulty} onChange={set('difficulty')} />
          </label>
        </div>
        <label className="field">
          <span>태그 (| 로 구분)</span>
          <input className="input" value={form.tags} onChange={set('tags')} />
        </label>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="btn btn--primary">
            저장
          </button>
        </div>
      </form>
    </div>
  );
}
