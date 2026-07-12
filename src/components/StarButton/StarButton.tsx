import type { MouseEvent } from 'react';
import { toggleStar } from '../../stores/appActions';

interface Props {
  cardId: string;
  starred: boolean;
  className?: string;
}

export function StarButton({ cardId, starred, className }: Props) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    // 별표는 카드 뒤집기/평가로 전파되지 않아야 한다
    e.stopPropagation();
    e.preventDefault();
    void toggleStar(cardId);
  };

  return (
    <button
      type="button"
      className={`star-button ${starred ? 'star-button--on' : ''} ${className ?? ''}`}
      onClick={handleClick}
      onPointerDown={(e) => e.stopPropagation()}
      aria-pressed={starred}
      aria-label={starred ? '별표 해제' : '별표 표시'}
    >
      {starred ? '★' : '☆'}
    </button>
  );
}
