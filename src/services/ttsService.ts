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

// Apple 기기에는 Albert, Bahh, Zarvox처럼 학습용 발음에 맞지 않는 효과음
// 음성도 en-US로 노출된다. 이름순 첫 항목을 고르면 이 음성들이 선택될 수 있다.
const NOVELTY_VOICE_NAMES = [
  'albert',
  'bad news',
  'bahh',
  'bells',
  'boing',
  'bubbles',
  'cellos',
  'deranged',
  'good news',
  'hysterical',
  'jester',
  'organ',
  'pipe organ',
  'princess',
  'superstar',
  'trinoids',
  'whisper',
  'wobble',
  'zarvox',
] as const;

const LEGACY_VOICE_NAMES = [
  'agnes',
  'bruce',
  'fred',
  'junior',
  'kathy',
  'ralph',
  'vicki',
  'victoria',
] as const;

// iOS/macOS와 주요 브라우저에서 자연스러운 일반 영어 음성으로 알려진 이름.
// 이름이 없어도 enhanced/natural/default/localService 점수로 안전하게 fallback한다.
const PREFERRED_VOICE_NAMES = [
  'samantha',
  'alex',
  'ava',
  'allison',
  'susan',
  'tom',
  'google us english',
  'microsoft aria',
  'microsoft jenny',
  'microsoft guy',
] as const;

function normalizedVoiceName(voice: SpeechSynthesisVoice): string {
  return voice.name.trim().toLowerCase();
}

function baseVoiceName(voice: SpeechSynthesisVoice): string {
  return normalizedVoiceName(voice)
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
}

function isEnglishVoice(voice: SpeechSynthesisVoice): boolean {
  return /^en(?:[-_]|$)/i.test(voice.lang.trim());
}

export function scoreEnglishVoice(voice: SpeechSynthesisVoice): number {
  if (!isEnglishVoice(voice)) return Number.NEGATIVE_INFINITY;

  const name = normalizedVoiceName(voice);
  const baseName = baseVoiceName(voice);
  if (NOVELTY_VOICE_NAMES.includes(baseName as (typeof NOVELTY_VOICE_NAMES)[number])) {
    return -10_000;
  }

  const lang = voice.lang.toLowerCase().replace('_', '-');
  let score = lang === 'en-us' ? 1_000 : 300;
  if (/natural|enhanced|premium|neural|siri/.test(name)) score += 400;

  const preferredIndex = PREFERRED_VOICE_NAMES.findIndex((candidate) =>
    name.includes(candidate),
  );
  if (preferredIndex >= 0) score += 300 - preferredIndex;
  if (voice.default) score += 120;
  if (voice.localService) score += 40;
  if (LEGACY_VOICE_NAMES.includes(baseName as (typeof LEGACY_VOICE_NAMES)[number])) {
    score -= 250;
  }
  return score;
}

export function sortEnglishVoices(
  voices: readonly SpeechSynthesisVoice[],
): SpeechSynthesisVoice[] {
  const usable = voices
    .filter(
      (voice) =>
        isEnglishVoice(voice) && scoreEnglishVoice(voice) > -10_000,
    );
  // 오프라인 앱에서는 로컬 음성이 하나라도 있으면 원격 합성 음성을 자동
  // 선택하지 않는다. 로컬 영어 음성이 전혀 없을 때만 원격을 fallback한다.
  const local = usable.filter((voice) => voice.localService);
  return (local.length > 0 ? local : usable)
    .slice()
    .sort(
      (a, b) =>
        scoreEnglishVoice(b) - scoreEnglishVoice(a) ||
        a.name.localeCompare(b.name),
    );
}

export function selectEnglishVoice(
  voices: readonly SpeechSynthesisVoice[],
  voiceURI?: string | null,
): SpeechSynthesisVoice | null {
  if (voiceURI) {
    const explicit = voices.find(
      (voice) =>
        voice.voiceURI === voiceURI &&
        isEnglishVoice(voice) &&
        scoreEnglishVoice(voice) > -10_000,
    );
    if (explicit && (explicit.localService || !voices.some(
      (voice) =>
        voice.localService &&
        isEnglishVoice(voice) &&
        scoreEnglishVoice(voice) > -10_000,
    ))) {
      return explicit;
    }
  }
  return sortEnglishVoices(voices)[0] ?? null;
}

export function normalizeSpeechText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

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
    return sortEnglishVoices(this.voices);
  }

  onVoicesChanged(listener: VoicesListener): () => void {
    this.listeners.add(listener);
    listener(this.voices);
    return () => this.listeners.delete(listener);
  }

  private pickVoice(voiceURI: string | null | undefined): SpeechSynthesisVoice | null {
    return selectEnglishVoice(this.voices, voiceURI);
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
      // iOS는 첫 사용자 동작 전후로 음성 목록이 달라질 수 있으므로 매번 갱신한다.
      this.refreshVoices();
      this.cancel();
      const speechText = normalizeSpeechText(text);
      if (speechText === '') {
        options.onError?.('재생할 영어 텍스트가 없습니다.');
        return;
      }
      const utterance = new SpeechSynthesisUtterance(speechText);
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
      // 일부 iPhone은 첫 speak 뒤에야 getVoices()를 채운다. 다음 재생을 위해
      // 목록만 다시 읽으며, 현재 문장을 중복 재생하지는 않는다.
      if (this.voices.length === 0) {
        window.setTimeout(() => this.refreshVoices(), 0);
        window.setTimeout(() => this.refreshVoices(), 300);
      }
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
