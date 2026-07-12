import { useEffect, useState } from 'react';
import { useAppState } from '../stores/appStore';
import { initApp } from '../stores/appActions';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { UpdatePrompt } from '../components/UpdatePrompt';
import { StudyPage } from '../pages/StudyPage/StudyPage';
import { WordListPage } from '../pages/WordListPage/WordListPage';
import { DataPage } from '../pages/DataPage/DataPage';
import { SettingsPage } from '../pages/SettingsPage/SettingsPage';
import { HelpPage } from '../pages/HelpPage/HelpPage';

type Tab = 'study' | 'words' | 'data' | 'settings' | 'help';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'study', label: '학습', icon: '🃏' },
  { id: 'words', label: '단어', icon: '📚' },
  { id: 'data', label: '데이터', icon: '💾' },
  { id: 'settings', label: '설정', icon: '⚙️' },
  { id: 'help', label: '안내', icon: '❓' },
];

let initStarted = false;

export function App() {
  const state = useAppState();
  const [tab, setTab] = useState<Tab>('study');

  useEffect(() => {
    // React StrictMode의 이중 마운트에서 시딩이 중복 실행되지 않도록 가드
    if (!initStarted) {
      initStarted = true;
      void initApp();
    }
  }, []);

  // 테마 적용 (시스템 자동 감지 + 설정 고정)
  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
  }, [state.settings.theme]);

  return (
    <ErrorBoundary>
      <div className="app">
        <UpdatePrompt />
        <div className="app__content">
          {state.status === 'loading' && (
            <div className="app__loading" role="status">
              <p>단어 데이터를 준비하는 중…</p>
              <p className="app__loading-note">
                첫 실행에서는 몇 초 걸릴 수 있습니다.
              </p>
            </div>
          )}
          {state.status === 'error' && (
            <div className="app__error" role="alert">
              <h1>시작 오류</h1>
              <p>{state.errorMessage}</p>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => window.location.reload()}
              >
                다시 시도
              </button>
            </div>
          )}
          {state.status === 'ready' && (
            <>
              {tab === 'study' && <StudyPage />}
              {tab === 'words' && <WordListPage onGoStudy={() => setTab('study')} />}
              {tab === 'data' && <DataPage />}
              {tab === 'settings' && <SettingsPage />}
              {tab === 'help' && <HelpPage />}
            </>
          )}
        </div>

        <nav className="tab-bar" aria-label="주 메뉴">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab-bar__item ${tab === t.id ? 'tab-bar__item--active' : ''}`}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id)}
            >
              <span className="tab-bar__icon" aria-hidden="true">
                {t.icon}
              </span>
              <span className="tab-bar__label">{t.label}</span>
            </button>
          ))}
        </nav>

        {state.toast !== null && (
          <div className="toast" role="status">
            {state.toast}
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
