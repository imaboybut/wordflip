import type { Card } from '../../types';
import { StarButton } from '../StarButton/StarButton';
import { TtsButton } from '../TtsButton/TtsButton';

interface Props {
  card: Card;
  flipped: boolean;
  animationsEnabled: boolean;
  onFlip: () => void;
}

export function StudyCard({ card, flipped, animationsEnabled, onFlip }: Props) {
  return (
    <div
      className={[
        'study-card',
        flipped ? 'study-card--flipped' : '',
        animationsEnabled ? '' : 'study-card--no-anim',
      ].join(' ')}
      role="button"
      tabIndex={0}
      aria-label={
        flipped
          ? '카드를 눌러 다음 단어 보기'
          : '카드를 눌러 뜻을 보고 모르는 단어로 표시'
      }
      data-testid="study-card"
      onClick={onFlip}
      onKeyDown={(e) => {
        // 안쪽의 별표/TTS 버튼에서 올라온 키보드 이벤트는 카드 탭이 아니다.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onFlip();
        }
      }}
    >
      <div className="study-card__inner">
        {/* 앞면 */}
        <div
          className="study-card__face study-card__front"
          aria-hidden={flipped}
          inert={flipped ? true : undefined}
          data-testid="study-card-front"
        >
          <div className="study-card__top">
            <div className="study-card__chips">
              {card.partOfSpeech && (
                <span className="chip chip--pos">{card.partOfSpeech}</span>
              )}
              {card.difficulty && (
                <span className="chip chip--level">{card.difficulty}</span>
              )}
              {card.category && (
                <span className="chip chip--category">{card.category}</span>
              )}
            </div>
            <StarButton cardId={card.id} starred={card.starred} />
          </div>
          <div className="study-card__word-area">
            <p className="study-card__word" lang="en">
              {card.word}
            </p>
            <TtsButton text={card.word} label="영어 발음 재생" />
          </div>
          <p className="study-card__hint">
            모르면 카드를 눌러 뜻 보기
          </p>
        </div>

        {/* 뒷면 */}
        <div
          className="study-card__face study-card__back"
          aria-hidden={!flipped}
          inert={!flipped ? true : undefined}
          data-testid="study-card-back"
        >
          <div className="study-card__top">
            <div className="study-card__word-row">
              <p className="study-card__word study-card__word--back" lang="en">
                {card.word}
              </p>
              <TtsButton text={card.word} label="단어 발음 재생" />
            </div>
            <StarButton cardId={card.id} starred={card.starred} />
          </div>
          <p className="study-card__meaning">{card.koreanMeaning}</p>
          {card.koreanPronunciation && (
            <p className="study-card__pronunciation">
              [{card.koreanPronunciation}]
            </p>
          )}
          {card.exampleSentence && (
            <div className="study-card__example">
              <div className="study-card__example-row">
                <p className="study-card__sentence" lang="en">
                  {card.exampleSentence}
                </p>
                <TtsButton text={card.exampleSentence} label="예문 발음 재생" />
              </div>
              <p className="study-card__translation">{card.exampleTranslation}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
