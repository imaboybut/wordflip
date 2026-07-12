import { useRef, useState, type ChangeEvent } from 'react';
import { useAppState } from '../../stores/appStore';
import {
  getActiveDb,
  importCsvText,
  rebuildFromLogs,
  resetAllData,
  restoreBackupJson,
  showToast,
} from '../../stores/appActions';
import { exportBackup } from '../../services/backupService';
import { exportCardsToCsv } from '../../services/csvService';
import { ConfirmDialog } from '../../components/ConfirmDialog';

export function DataPage() {
  const { cards, seedReport, settings, studyStep, schedules } = useAppState();
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [preserveProgress, setPreserveProgress] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmReseed, setConfirmReseed] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const withBusy = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '작업에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleCsvFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void withBusy(async () => {
      const text = await file.text();
      const message = await importCsvText(text, {
        mode: importMode,
        preserveProgress,
      });
      showToast(message);
    });
  };

  const handleJsonFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void withBusy(async () => {
      const text = await file.text();
      const message = await restoreBackupJson(text);
      showToast(message);
    });
  };

  const download = (name: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const stamp = () => new Date().toISOString().slice(0, 10);

  return (
    <div className="data-page">
      <section className="panel">
        <h2 className="panel__title">CSV 가져오기</h2>
        <div className="field-row">
          <label className="radio">
            <input
              type="radio"
              name="import-mode"
              checked={importMode === 'merge'}
              onChange={() => setImportMode('merge')}
            />
            기존 데이터에 병합
          </label>
          <label className="radio">
            <input
              type="radio"
              name="import-mode"
              checked={importMode === 'replace'}
              onChange={() => setImportMode('replace')}
            />
            전체 교체
          </label>
        </div>
        {importMode === 'replace' && (
          <label className="radio">
            <input
              type="checkbox"
              checked={preserveProgress}
              onChange={(e) => setPreserveProgress(e.target.checked)}
            />
            같은 단어의 복습 기록 보존
          </label>
        )}
        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={busy}
          onClick={() => csvInputRef.current?.click()}
        >
          CSV 파일 선택
        </button>
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={handleCsvFile}
          aria-label="CSV 파일 선택"
        />
        <p className="panel__note">
          병합: 같은 id는 내용 갱신(기록 유지), 같은 단어는 건너뜀. 교체: 전체를 새
          목록으로 바꿉니다.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel__title">내보내기</h2>
        <div className="panel__row">
          <button
            type="button"
            className="btn btn--block"
            disabled={busy}
            onClick={() =>
              download(
                `wordflip-words-${stamp()}.csv`,
                '﻿' + exportCardsToCsv([...cards.values()].sort((a, b) => a.orderIndex - b.orderIndex)),
                'text/csv;charset=utf-8',
              )
            }
          >
            전체 CSV 내보내기
          </button>
          <button
            type="button"
            className="btn btn--block"
            disabled={busy}
            onClick={() => {
              const starred = [...cards.values()]
                .filter((c) => c.starred)
                .sort((a, b) => a.orderIndex - b.orderIndex);
              if (starred.length === 0) {
                showToast('별표 카드가 없습니다.');
                return;
              }
              download(
                `wordflip-starred-${stamp()}.csv`,
                '﻿' + exportCardsToCsv(starred),
                'text/csv;charset=utf-8',
              );
            }}
          >
            별표 CSV 내보내기
          </button>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">JSON 백업 / 복원</h2>
        <div className="panel__row">
          <button
            type="button"
            className="btn btn--block"
            disabled={busy}
            onClick={() =>
              void withBusy(async () => {
                const backup = await exportBackup(getActiveDb());
                download(
                  `wordflip-backup-${stamp()}.json`,
                  JSON.stringify(backup),
                  'application/json',
                );
              })
            }
          >
            JSON 전체 백업
          </button>
          <button
            type="button"
            className="btn btn--block"
            disabled={busy}
            onClick={() => jsonInputRef.current?.click()}
          >
            JSON 복원
          </button>
        </div>
        <input
          ref={jsonInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={handleJsonFile}
          aria-label="JSON 백업 파일 선택"
        />
        <p className="panel__note">
          백업에는 단어, 학습 상태, 복습 로그, 설정이 모두 포함됩니다.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel__title">복구 도구</h2>
        <button
          type="button"
          className="btn btn--block"
          disabled={busy}
          onClick={() =>
            void withBusy(async () => {
              const message = await rebuildFromLogs();
              showToast(message);
            })
          }
        >
          복습 로그로 스케줄 재계산
        </button>
        <p className="panel__note">
          스케줄 상태가 이상할 때 append-only 복습 로그를 처음부터 재생하여
          복구합니다.
        </p>
      </section>

      <section className="panel panel--danger">
        <h2 className="panel__title">위험 구역</h2>
        <div className="panel__row">
          <button
            type="button"
            className="btn btn--block"
            disabled={busy}
            onClick={() => setConfirmReseed(true)}
          >
            샘플 데이터 다시 불러오기
          </button>
          <button
            type="button"
            className="btn btn--danger btn--block"
            disabled={busy}
            onClick={() => setConfirmReset(true)}
          >
            전체 초기화
          </button>
        </div>
      </section>

      {seedReport && (
        <section className="panel">
          <h2 className="panel__title">초기 데이터 가져오기 결과</h2>
          <p className="panel__note">
            {seedReport.imported.toLocaleString()}개 가져옴
            {seedReport.skipped.length > 0 &&
              ` · ${seedReport.skipped.length}개 건너뜀`}
          </p>
          {seedReport.skipped.length > 0 && (
            <details>
              <summary>건너뛴 행 보기</summary>
              <ul className="panel__list">
                {seedReport.skipped.slice(0, 50).map((s) => (
                  <li key={`${s.row}-${s.reason}`}>
                    {s.row}행: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {settings.showDiagnostics && (
        <section className="panel">
          <h2 className="panel__title">진단 정보</h2>
          <p className="panel__note">
            카드 {cards.size.toLocaleString()}개 · 학습된 카드{' '}
            {schedules.size.toLocaleString()}개 · 누적 평가 {studyStep.toLocaleString()}회 ·
            FSRS-6
          </p>
        </section>
      )}

      <ConfirmDialog
        open={confirmReseed}
        title="샘플 데이터 다시 불러오기"
        confirmLabel="초기화 후 불러오기"
        danger
        onConfirm={() => {
          setConfirmReseed(false);
          void withBusy(async () => {
            await resetAllData();
            showToast('샘플 데이터를 다시 불러왔습니다.');
          });
        }}
        onCancel={() => setConfirmReseed(false)}
      >
        <p>
          현재 단어와 학습 기록을 모두 지우고 초기 words.csv를 다시 불러옵니다.
          계속하시겠습니까?
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmReset}
        title="전체 초기화"
        confirmLabel="모두 삭제"
        danger
        onConfirm={() => {
          setConfirmReset(false);
          void withBusy(async () => {
            await resetAllData();
            showToast('모든 데이터를 초기화했습니다.');
          });
        }}
        onCancel={() => setConfirmReset(false)}
      >
        <p>
          모든 단어, 학습 기록, 설정이 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
          먼저 JSON 백업을 만들어 두는 것을 권장합니다.
        </p>
      </ConfirmDialog>
    </div>
  );
}
