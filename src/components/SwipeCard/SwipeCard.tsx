import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { Rating } from '../../types';

interface Props {
  /** 카드가 뒤집힌 뒤에만 평가 스와이프 허용 */
  canRate: boolean;
  swipeEnabled: boolean;
  animationsEnabled: boolean;
  onRate: (rating: Rating) => void;
  onTap: () => void;
  children: ReactNode;
}

const EDGE_GUARD_PX = 24; // iPhone Safari 뒤로가기 edge swipe와 충돌 방지
const AXIS_LOCK_DIST = 14;
const PREVIEW_DIST = 44;
const COMMIT_DIST = 96;
const FLICK_DIST = 52;
const FLICK_VELOCITY = 0.6; // px/ms
const TAP_DIST = 10;
const TAP_TIME = 500;

const RATING_LABEL: Record<Rating, string> = {
  again: 'Again — 다시',
  hard: 'Hard — 어려움',
  good: 'Good — 알겠음',
  easy: 'Easy — 쉬움',
};

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startTime: number;
  edgeGuarded: boolean;
  axis: 'x' | 'y' | null;
  dx: number;
  dy: number;
}

export function SwipeCard({
  canRate,
  swipeEnabled,
  animationsEnabled,
  onRate,
  onTap,
  children,
}: Props) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const committedRef = useRef(false);
  // 포인터 시퀀스로 탭을 처리한 뒤 뒤따라오는 click 이벤트 중복 방지
  const suppressClickRef = useRef(false);
  const [preview, setPreview] = useState<Rating | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const animate = animationsEnabled && !reducedMotion;

  const resetTransform = useCallback(
    (spring: boolean) => {
      const el = innerRef.current;
      if (!el) return;
      el.style.transition = spring && animate ? 'transform 0.18s ease-out' : 'none';
      el.style.transform = '';
    },
    [animate],
  );

  // 카드가 바뀌면 잔여 변형 제거
  useEffect(() => {
    committedRef.current = false;
    resetTransform(false);
    setPreview(null);
  }, [children, resetTransform]);

  const ratingFor = (drag: DragState): Rating | null => {
    if (drag.axis === 'x') {
      if (drag.edgeGuarded) return null;
      return drag.dx < 0 ? 'again' : 'easy';
    }
    if (drag.axis === 'y') {
      return drag.dy < 0 ? 'good' : 'hard';
    }
    return null;
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current !== null || committedRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const vw = window.innerWidth;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTime: performance.now(),
      // 화면 가장자리 24px 안에서 시작한 수평 제스처는 평가로 처리하지 않음
      edgeGuarded: e.clientX < EDGE_GUARD_PX || e.clientX > vw - EDGE_GUARD_PX,
      axis: null,
      dx: 0,
      dy: 0,
    };
    zoneRef.current?.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || committedRef.current) return;
    drag.dx = e.clientX - drag.startX;
    drag.dy = e.clientY - drag.startY;

    if (!swipeEnabled || !canRate) return;

    const dist = Math.hypot(drag.dx, drag.dy);
    if (drag.axis === null && dist > AXIS_LOCK_DIST) {
      drag.axis = Math.abs(drag.dx) >= Math.abs(drag.dy) ? 'x' : 'y';
    }
    if (drag.axis === null) return;

    // 카드가 손가락을 따라오게 한다 (re-render 없이 직접 스타일 조작)
    const el = innerRef.current;
    if (el) {
      el.style.transition = 'none';
      const rot = drag.axis === 'x' ? drag.dx * 0.04 : 0;
      el.style.transform = `translate(${drag.dx}px, ${drag.dy}px) rotate(${rot}deg)`;
    }

    const nextPreview =
      (drag.axis === 'x' ? Math.abs(drag.dx) : Math.abs(drag.dy)) > PREVIEW_DIST
        ? ratingFor(drag)
        : null;
    setPreview((p) => (p === nextPreview ? p : nextPreview));
  };

  const finishDrag = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setPreview(null);
    zoneRef.current?.releasePointerCapture?.(e.pointerId);
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 350);

    if (committedRef.current) return;

    const dt = performance.now() - drag.startTime;
    const dist = Math.hypot(drag.dx, drag.dy);

    if (cancelled) {
      resetTransform(true);
      return;
    }

    // 짧은 터치는 카드 뒤집기
    if (dist < TAP_DIST && dt < TAP_TIME) {
      resetTransform(false);
      onTap();
      return;
    }

    if (!swipeEnabled || !canRate) {
      resetTransform(true);
      return;
    }

    const rating = ratingFor(drag);
    const mainDist = drag.axis === 'x' ? Math.abs(drag.dx) : Math.abs(drag.dy);
    const velocity = mainDist / Math.max(dt, 1);
    const shouldCommit =
      rating !== null &&
      (mainDist > COMMIT_DIST || (mainDist > FLICK_DIST && velocity > FLICK_VELOCITY));

    if (!shouldCommit || rating === null) {
      resetTransform(true);
      return;
    }

    committedRef.current = true;
    const el = innerRef.current;
    if (el && animate) {
      const fx = drag.axis === 'x' ? Math.sign(drag.dx) * window.innerWidth : 0;
      const fy = drag.axis === 'y' ? Math.sign(drag.dy) * window.innerHeight * 0.7 : 0;
      el.style.transition = 'transform 0.16s ease-in, opacity 0.16s ease-in';
      el.style.transform = `translate(${fx}px, ${fy}px)`;
      el.style.opacity = '0';
      window.setTimeout(() => {
        if (el) {
          el.style.transition = 'none';
          el.style.transform = '';
          el.style.opacity = '';
        }
        committedRef.current = false;
        onRate(rating);
      }, 170);
    } else {
      committedRef.current = false;
      resetTransform(false);
      onRate(rating);
    }
  };

  return (
    <div
      ref={zoneRef}
      className="swipe-zone"
      data-testid="swipe-zone"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finishDrag(e, false)}
      onPointerCancel={(e) => finishDrag(e, true)}
      onClickCapture={(e) => {
        if (suppressClickRef.current) {
          e.preventDefault();
          e.stopPropagation();
          suppressClickRef.current = false;
        }
      }}
    >
      <div ref={innerRef} className="swipe-zone__inner">
        {children}
      </div>
      {preview !== null && (
        <div
          className={`swipe-preview swipe-preview--${preview}`}
          aria-hidden="true"
          data-testid="swipe-preview"
        >
          {RATING_LABEL[preview]}
        </div>
      )}
    </div>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = () => setReduced(mq.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);
  return reduced;
}
