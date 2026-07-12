import type { Rating } from '../../types';

interface Props {
  disabled: boolean;
  onRate: (rating: Rating) => void;
  /** 진단 모드에서만 표시하는 간격 미리보기 (step) */
  previews?: Record<Rating, number> | null;
}

const BUTTONS: { rating: Rating; en: string; ko: string }[] = [
  { rating: 'again', en: 'Again', ko: '다시' },
  { rating: 'hard', en: 'Hard', ko: '어려움' },
  { rating: 'good', en: 'Good', ko: '알겠음' },
  { rating: 'easy', en: 'Easy', ko: '쉬움' },
];

export function RatingButtons({ disabled, onRate, previews }: Props) {
  return (
    <div className="rating-buttons" role="group" aria-label="카드 평가">
      {BUTTONS.map(({ rating, en, ko }) => (
        <button
          key={rating}
          type="button"
          className={`rating-button rating-button--${rating}`}
          disabled={disabled}
          onClick={() => onRate(rating)}
        >
          <span className="rating-button__en">{en}</span>
          <span className="rating-button__ko">{ko}</span>
          {previews && (
            <span className="rating-button__preview">+{previews[rating]}</span>
          )}
        </button>
      ))}
    </div>
  );
}
