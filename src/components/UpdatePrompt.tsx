import { useEffect, useRef, useState } from 'react';

/**
 * 새 service worker 버전 감지 → 사용자가 승인하면 활성화.
 * virtual:pwa-register 모듈은 테스트 환경에 없으므로 동적 import + 무시 처리.
 */
export function UpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const updateRef = useRef<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    let unmounted = false;
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        if (unmounted) return;
        updateRef.current = registerSW({
          onNeedRefresh() {
            if (!unmounted) setNeedRefresh(true);
          },
        });
      })
      .catch(() => {
        // SW 미지원/테스트 환경: 조용히 무시
      });
    return () => {
      unmounted = true;
    };
  }, []);

  if (!needRefresh) return null;

  return (
    <div className="update-prompt" role="status">
      <span>새 버전이 준비되었습니다.</span>
      <div className="update-prompt__actions">
        <button
          type="button"
          className="btn btn--primary btn--small"
          onClick={() => {
            void updateRef.current?.(true);
          }}
        >
          업데이트
        </button>
        <button
          type="button"
          className="btn btn--small"
          onClick={() => setNeedRefresh(false)}
        >
          나중에
        </button>
      </div>
    </div>
  );
}
