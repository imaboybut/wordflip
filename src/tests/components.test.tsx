import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudyCard } from '../components/StudyCard/StudyCard';
import { RatingButtons } from '../components/RatingButtons/RatingButtons';
import { SwipeCard } from '../components/SwipeCard/SwipeCard';
import { TtsButton } from '../components/TtsButton/TtsButton';
import { makeCard } from './helpers';

const card = makeCard({
  id: 'c1',
  word: 'steadily',
  koreanMeaning: '꾸준히',
  koreanPronunciation: '스테덜리',
  exampleSentence: 'My English is improving steadily.',
  exampleTranslation: '내 영어 실력은 꾸준히 향상되고 있다.',
});

describe('StudyCard', () => {
  it('앞면에는 단어가 보이고 탭하면 뒤집기 콜백이 호출된다', async () => {
    const onFlip = vi.fn();
    render(
      <StudyCard card={card} flipped={false} animationsEnabled={false} onFlip={onFlip} />,
    );
    expect(screen.getAllByText('steadily').length).toBeGreaterThan(0);
    expect(screen.getByText('카드를 눌러 뜻 보기')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('study-card'));
    expect(onFlip).toHaveBeenCalledTimes(1);
  });

  it('뒷면에는 뜻/발음/예문이 표시된다', () => {
    render(
      <StudyCard card={card} flipped animationsEnabled={false} onFlip={() => {}} />,
    );
    expect(screen.getByText('꾸준히')).toBeInTheDocument();
    expect(screen.getByText('[스테덜리]')).toBeInTheDocument();
    expect(screen.getByText('My English is improving steadily.')).toBeInTheDocument();
    expect(
      screen.getByText('내 영어 실력은 꾸준히 향상되고 있다.'),
    ).toBeInTheDocument();
  });

  it('보이지 않는 카드 면은 inert로 포커스 탐색에서 제외한다', () => {
    const view = render(
      <StudyCard card={card} flipped={false} animationsEnabled={false} onFlip={() => {}} />,
    );
    expect(screen.getByTestId('study-card-front')).not.toHaveAttribute('inert');
    expect(screen.getByTestId('study-card-back')).toHaveAttribute('inert');

    view.rerender(
      <StudyCard card={card} flipped animationsEnabled={false} onFlip={() => {}} />,
    );
    expect(screen.getByTestId('study-card-front')).toHaveAttribute('inert');
    expect(screen.getByTestId('study-card-back')).not.toHaveAttribute('inert');
  });

  it('별표 클릭은 카드 뒤집기로 전파되지 않는다', async () => {
    const onFlip = vi.fn();
    render(
      <StudyCard card={card} flipped={false} animationsEnabled={false} onFlip={onFlip} />,
    );
    await userEvent.click(screen.getAllByRole('button', { name: '별표 표시' })[0]);
    expect(onFlip).not.toHaveBeenCalled();
  });

  it('별표/TTS 버튼의 키보드 이벤트도 카드 탭으로 전파되지 않는다', () => {
    const onFlip = vi.fn();
    render(
      <StudyCard card={card} flipped={false} animationsEnabled={false} onFlip={onFlip} />,
    );
    fireEvent.keyDown(screen.getAllByRole('button', { name: '별표 표시' })[0], {
      key: 'Enter',
    });
    fireEvent.keyDown(screen.getByRole('button', { name: '영어 발음 재생' }), {
      key: ' ',
    });
    expect(onFlip).not.toHaveBeenCalled();
  });

  it('키보드(Enter)로도 뒤집을 수 있다', () => {
    const onFlip = vi.fn();
    render(
      <StudyCard card={card} flipped={false} animationsEnabled={false} onFlip={onFlip} />,
    );
    fireEvent.keyDown(screen.getByTestId('study-card'), { key: 'Enter' });
    expect(onFlip).toHaveBeenCalledTimes(1);
  });
});

describe('RatingButtons', () => {
  it('네 버튼이 한국어 보조 문구와 함께 표시된다', () => {
    render(<RatingButtons disabled={false} onRate={() => {}} />);
    expect(screen.getByText('Again')).toBeInTheDocument();
    expect(screen.getByText('모름')).toBeInTheDocument();
    expect(screen.getByText('Hard')).toBeInTheDocument();
    expect(screen.getByText('힘들게 기억')).toBeInTheDocument();
    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(screen.getByText('기억함')).toBeInTheDocument();
    expect(screen.getByText('Easy')).toBeInTheDocument();
    expect(screen.getByText('바로 기억')).toBeInTheDocument();
  });

  it('버튼으로 평가할 수 있다', async () => {
    const onRate = vi.fn();
    render(<RatingButtons disabled={false} onRate={onRate} />);
    await userEvent.click(screen.getByText('Good'));
    expect(onRate).toHaveBeenCalledWith('good');
  });

  it('disabled면 평가되지 않는다', () => {
    const onRate = vi.fn();
    render(<RatingButtons disabled onRate={onRate} />);
    fireEvent.click(screen.getByText('Good'));
    expect(onRate).not.toHaveBeenCalled();
  });
});

describe('SwipeCard 제스처', () => {
  function swipe(
    el: HTMLElement,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) {
    fireEvent.pointerDown(el, {
      pointerId: 1,
      clientX: from.x,
      clientY: from.y,
      button: 0,
    });
    // 중간 지점 이동
    fireEvent.pointerMove(el, {
      pointerId: 1,
      clientX: (from.x + to.x) / 2,
      clientY: (from.y + to.y) / 2,
    });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: to.x, clientY: to.y });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: to.x, clientY: to.y });
  }

  function renderSwipe(canRate: boolean, onRate = vi.fn(), onTap = vi.fn()) {
    const view = render(
      <SwipeCard
        canRate={canRate}
        swipeEnabled
        animationsEnabled={false}
        onRate={onRate}
        onTap={onTap}
      >
        <div style={{ width: 300, height: 400 }}>card</div>
      </SwipeCard>,
    );
    return {
      zone: screen.getByTestId('swipe-zone'),
      onRate,
      onTap,
      unmount: view.unmount,
    };
  }

  it('뒤집힌 뒤 왼쪽 스와이프 → Again', () => {
    const { zone, onRate } = renderSwipe(true);
    swipe(zone, { x: 400, y: 300 }, { x: 220, y: 305 });
    expect(onRate).toHaveBeenCalledWith('again');
  });

  it('오른쪽 → Easy, 위 → Good, 아래 → Hard', () => {
    const r1 = renderSwipe(true);
    swipe(r1.zone, { x: 300, y: 300 }, { x: 480, y: 300 });
    expect(r1.onRate).toHaveBeenCalledWith('easy');
    r1.unmount();

    const r2 = renderSwipe(true);
    swipe(r2.zone, { x: 300, y: 300 }, { x: 300, y: 140 });
    expect(r2.onRate).toHaveBeenCalledWith('good');
    r2.unmount();

    const r3 = renderSwipe(true);
    swipe(r3.zone, { x: 300, y: 200 }, { x: 300, y: 380 });
    expect(r3.onRate).toHaveBeenCalledWith('hard');
  });

  it('카드를 뒤집기 전에는 스와이프 평가가 작동하지 않는다', () => {
    const { zone, onRate } = renderSwipe(false);
    swipe(zone, { x: 400, y: 300 }, { x: 200, y: 300 });
    expect(onRate).not.toHaveBeenCalled();
  });

  it('화면 왼쪽 가장자리 24px 안에서 시작한 수평 제스처는 평가하지 않는다', () => {
    const { zone, onRate } = renderSwipe(true);
    swipe(zone, { x: 10, y: 300 }, { x: 250, y: 300 });
    expect(onRate).not.toHaveBeenCalled();
  });

  it('이동 거리가 짧으면 평가가 확정되지 않는다', () => {
    const { zone, onRate } = renderSwipe(true);
    swipe(zone, { x: 300, y: 300 }, { x: 330, y: 300 });
    expect(onRate).not.toHaveBeenCalled();
  });

  it('짧은 터치는 카드 뒤집기로 처리한다', () => {
    const { zone, onRate, onTap } = renderSwipe(true);
    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 300, clientY: 300, button: 0 });
    fireEvent.pointerUp(zone, { pointerId: 1, clientX: 302, clientY: 301 });
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onRate).not.toHaveBeenCalled();
  });

  it('스와이프 비활성화 시 세로 스크롤 가능한 탭 전용 영역이 된다', () => {
    render(
      <SwipeCard
        canRate={false}
        swipeEnabled={false}
        animationsEnabled={false}
        onRate={() => {}}
        onTap={() => {}}
      >
        <div>card</div>
      </SwipeCard>,
    );
    expect(screen.getByTestId('swipe-zone')).toHaveClass('swipe-zone--tap-only');
  });

  it('스와이프 중 평가 방향 미리보기가 표시된다', () => {
    const { zone } = renderSwipe(true);
    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 400, clientY: 300, button: 0 });
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 320, clientY: 300 });
    expect(screen.getByTestId('swipe-preview')).toHaveTextContent('Again — 모름');
    fireEvent.pointerUp(zone, { pointerId: 1, clientX: 400, clientY: 300 });
  });
});

describe('TTS 미지원 환경', () => {
  it('speechSynthesis가 없어도 버튼이 깨지지 않고 비활성화된다', async () => {
    // jsdom에는 speechSynthesis가 없다
    expect('speechSynthesis' in window).toBe(false);
    render(<TtsButton text="hello" label="영어 발음 재생" />);
    const btn = screen.getByRole('button', { name: '영어 발음 재생' });
    expect(btn).toBeDisabled();
    await userEvent.click(btn); // 클릭해도 예외 없음
  });
});
