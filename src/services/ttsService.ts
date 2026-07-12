/**
 * 브라우저 내장 speechSynthesis 만 사용하는 발음 서비스.
 * 외부 API, 원격 음성 파일, 네트워크 다운로드는 사용하지 않는다.
 */

export interface SpeakOptions {
  rate?: number;
  voiceURI?: string | null;
  onError?: (message: string) => void;
}

type VoicesListener = (voices: SpeechSynthesisVoice[]) => void;

class TtsService {
  readonly supported: boolean;
  private voices: SpeechSynthesisVoice[] = [];
  private listeners = new Set<VoicesListener>();

  constructor() {
    this.supported =
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      typeof window.SpeechSynthesisUtterance !== 'undefined';

    if (this.supported) {
      this.refreshVoices();
      // iOS Safari는 음성 목록이 늦게 로드되므로 voiceschanged를 반드시 처리
      window.speechSynthesis.addEventListener?.('voiceschanged', () => {
        this.refreshVoices();
      });
      // 앱이 백그라운드로 가면 재생 중인 음성을 취소
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.cancel();
      });
    }
  }

  private refreshVoices(): void {
    if (!this.supported) return;
    this.voices = window.speechSynthesis.getVoices();
    for (const l of this.listeners) l(this.voices);
  }

  getEnglishVoices(): SpeechSynthesisVoice[] {
    const en = this.voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
    // en-US 우선 정렬
    return en.sort((a, b) => {
      const aUS = a.lang.toLowerCase() === 'en-us' ? 0 : 1;
      const bUS = b.lang.toLowerCase() === 'en-us' ? 0 : 1;
      return aUS - bUS || a.name.localeCompare(b.name);
    });
  }

  onVoicesChanged(listener: VoicesListener): () => void {
    this.listeners.add(listener);
    listener(this.voices);
    return () => this.listeners.delete(listener);
  }

  private pickVoice(voiceURI: string | null | undefined): SpeechSynthesisVoice | null {
    const english = this.getEnglishVoices();
    if (voiceURI) {
      const exact = this.voices.find((v) => v.voiceURI === voiceURI);
      if (exact) return exact;
    }
    // en-US 우선, 없으면 다른 영어 음성으로 fallback
    return english[0] ?? null;
  }

  /**
   * 재생 중 다시 호출하면 기존 음성을 취소하고 새로 재생한다.
   * 실패해도 학습 흐름을 막지 않는다 (onError 콜백으로 비차단 알림만).
   */
  speak(text: string, options: SpeakOptions = {}): void {
    if (!this.supported) {
      options.onError?.('이 브라우저에서는 음성 재생을 지원하지 않습니다.');
      return;
    }
    try {
      this.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      const voice = this.pickVoice(options.voiceURI);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }
      const rate = options.rate ?? 1.0;
      utterance.rate = Math.min(2, Math.max(0.5, rate));
      utterance.onerror = (e) => {
        if (e.error === 'canceled' || e.error === 'interrupted') return;
        options.onError?.('음성을 재생하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      };
      window.speechSynthesis.speak(utterance);
    } catch {
      options.onError?.('음성을 재생하지 못했습니다.');
    }
  }

  cancel(): void {
    if (!this.supported) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // 취소 실패는 무시 (학습 흐름 비차단)
    }
  }
}

export const tts = new TtsService();
