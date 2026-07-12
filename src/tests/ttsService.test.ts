import { describe, expect, it } from 'vitest';
import {
  normalizeSpeechText,
  selectEnglishVoice,
  sortEnglishVoices,
} from '../services/ttsService';

function voice(
  name: string,
  lang = 'en-US',
  overrides: Partial<SpeechSynthesisVoice> = {},
): SpeechSynthesisVoice {
  return {
    default: false,
    lang,
    localService: true,
    name,
    voiceURI: `voice:${name}`,
    ...overrides,
  };
}

describe('TTS 영어 음성 자동 선택', () => {
  it('iPhone 캐릭터 음성보다 자연스러운 일반 음성을 선택한다', () => {
    const albert = voice('Albert');
    const zarvox = voice('Zarvox');
    const samantha = voice('Samantha');
    expect(selectEnglishVoice([albert, zarvox, samantha])?.name).toBe(
      'Samantha',
    );
  });

  it('Natural/Enhanced 미국 영어 음성을 우선한다', () => {
    const standard = voice('Generic US Voice');
    const enhanced = voice('Ava (Enhanced)');
    expect(sortEnglishVoices([standard, enhanced])[0]?.name).toBe(
      'Ava (Enhanced)',
    );
  });

  it('오프라인을 위해 원격 Natural 음성보다 로컬 영어 음성을 우선한다', () => {
    const remoteNatural = voice('Cloud Natural Premium', 'en-US', {
      localService: false,
    });
    const localStandard = voice('Generic Local US');
    expect(sortEnglishVoices([remoteNatural, localStandard])[0]).toBe(
      localStandard,
    );
  });

  it('저장된 비영어 음성 URI는 무시하고 영어 음성으로 복구한다', () => {
    const korean = voice('Yuna', 'ko-KR', { voiceURI: 'saved-wrong' });
    const english = voice('Samantha');
    expect(selectEnglishVoice([korean, english], 'saved-wrong')).toBe(english);
  });

  it('저장된 iPhone 효과음 음성도 무시하고 일반 음성으로 복구한다', () => {
    const albert = voice('Albert', 'en-US', { voiceURI: 'saved-novelty' });
    const samantha = voice('Samantha');
    expect(selectEnglishVoice([albert, samantha], 'saved-novelty')).toBe(
      samantha,
    );
  });

  it('사용자가 명시적으로 고른 영어 음성은 그대로 사용한다', () => {
    const samantha = voice('Samantha');
    const alex = voice('Alex');
    expect(selectEnglishVoice([samantha, alex], alex.voiceURI)).toBe(alex);
  });

  it('이름에 organ 문자열만 포함된 정상 음성을 오탐하지 않는다', () => {
    const morgan = voice('Morgan Natural');
    expect(sortEnglishVoices([morgan])).toEqual([morgan]);
  });
});

describe('TTS 텍스트 정리', () => {
  it('공백과 스마트 아포스트로피를 음성 합성에 안전하게 정리한다', () => {
    expect(normalizeSpeechText("  I\u2019m   ready.\nLet's go.  ")).toBe(
      "I'm ready. Let's go.",
    );
  });
});
