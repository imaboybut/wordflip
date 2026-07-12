import type { MouseEvent } from 'react';
import { tts } from '../../services/ttsService';
import { showToast } from '../../stores/appActions';
import { useAppState } from '../../stores/appStore';

interface Props {
  text: string;
  label: string;
  className?: string;
}

export function TtsButton({ text, label, className }: Props) {
  const { settings } = useAppState();

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    tts.speak(text, {
      rate: settings.ttsRate,
      voiceURI: settings.ttsVoiceURI,
      onError: showToast,
    });
  };

  return (
    <button
      type="button"
      className={`tts-button ${className ?? ''}`}
      onClick={handleClick}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={label}
      disabled={!tts.supported}
      title={tts.supported ? label : '이 브라우저에서는 음성을 지원하지 않습니다'}
    >
      <span aria-hidden="true">🔊</span>
    </button>
  );
}
