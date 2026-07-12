import { useEffect, useState } from 'react';
import { useAppState } from '../../stores/appStore';
import { showToast, updateSettings } from '../../stores/appActions';
import { tts } from '../../services/ttsService';

export function SettingsPage() {
  const { settings } = useAppState();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!tts.supported) return;
    return tts.onVoicesChanged(() => setVoices(tts.getEnglishVoices()));
  }, []);

  return (
    <div className="settings-page">
      <section className="panel">
        <h2 className="panel__title">화면</h2>
        <div className="field">
          <span className="field__label">테마</span>
          <div className="segmented" role="radiogroup" aria-label="테마">
            {(
              [
                ['system', '시스템'],
                ['light', '밝게'],
                ['dark', '어둡게'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={settings.theme === value}
                className={`segmented__item ${settings.theme === value ? 'segmented__item--active' : ''}`}
                onClick={() => void updateSettings({ theme: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="switch-row">
          <span>카드 애니메이션</span>
          <input
            type="checkbox"
            checked={settings.animationsEnabled}
            onChange={(e) =>
              void updateSettings({ animationsEnabled: e.target.checked })
            }
          />
        </label>
      </section>

      <section className="panel">
        <h2 className="panel__title">학습</h2>
        <div className="field">
          <span className="field__label">신규 카드 순서</span>
          <div className="segmented" role="radiogroup" aria-label="신규 카드 순서">
            {(
              [
                ['csv', 'CSV 순서'],
                ['random', '무작위'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={settings.newCardOrder === value}
                className={`segmented__item ${settings.newCardOrder === value ? 'segmented__item--active' : ''}`}
                onClick={() => void updateSettings({ newCardOrder: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="switch-row">
          <span>스와이프로 평가</span>
          <input
            type="checkbox"
            checked={settings.swipeEnabled}
            onChange={(e) => void updateSettings({ swipeEnabled: e.target.checked })}
          />
        </label>
        <label className="field">
          <span className="field__label">
            최근 카드 반복 방지 개수: {settings.avoidRecentCount}
          </span>
          <input
            type="range"
            min={0}
            max={10}
            step={1}
            value={settings.avoidRecentCount}
            onChange={(e) =>
              void updateSettings({ avoidRecentCount: Number(e.target.value) })
            }
            aria-label="최근 카드 반복 방지 개수"
          />
        </label>
      </section>

      <section className="panel">
        <h2 className="panel__title">발음 (TTS)</h2>
        {tts.supported ? (
          <>
            <label className="field">
              <span className="field__label">
                속도: {settings.ttsRate.toFixed(1)}x
              </span>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.1}
                value={settings.ttsRate}
                onChange={(e) =>
                  void updateSettings({ ttsRate: Number(e.target.value) })
                }
                aria-label="발음 속도"
              />
            </label>
            <label className="field">
              <span className="field__label">음성</span>
              <select
                className="input input--select"
                value={settings.ttsVoiceURI ?? ''}
                onChange={(e) =>
                  void updateSettings({
                    ttsVoiceURI: e.target.value === '' ? null : e.target.value,
                  })
                }
              >
                <option value="">자동 (en-US 우선)</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn--small"
              onClick={() =>
                tts.speak('My English is improving steadily.', {
                  rate: settings.ttsRate,
                  voiceURI: settings.ttsVoiceURI,
                  onError: showToast,
                })
              }
            >
              🔊 테스트 재생
            </button>
            <p className="panel__note">
              iPhone에서 음성 목록은 처음 재생 후에 채워질 수 있습니다.
            </p>
          </>
        ) : (
          <p className="panel__note">
            이 브라우저에서는 음성 합성을 지원하지 않습니다. 한글 발음 표기는
            계속 표시됩니다.
          </p>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">고급</h2>
        <label className="switch-row">
          <span>내부 진단 정보 표시</span>
          <input
            type="checkbox"
            checked={settings.showDiagnostics}
            onChange={(e) =>
              void updateSettings({ showDiagnostics: e.target.checked })
            }
          />
        </label>
        <p className="panel__note">
          학습 화면에 dueStep, interval, ease 등 내부 값을 표시합니다.
        </p>
      </section>
    </div>
  );
}
