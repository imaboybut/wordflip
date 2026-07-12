/**
 * 고유 id 생성. crypto.randomUUID는 보안 컨텍스트(HTTPS/localhost)에서만
 * 존재하므로, LAN HTTP로 레이아웃 테스트할 때를 위한 fallback을 둔다.
 */
export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
