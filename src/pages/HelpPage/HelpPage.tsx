export function HelpPage() {
  return (
    <div className="help-page">
      <section className="panel">
        <h2 className="panel__title">iPhone 홈 화면에 설치하기</h2>
        <ol className="help-steps">
          <li>iPhone의 Safari에서 이 페이지를 엽니다.</li>
          <li>
            Safari의 공유 버튼(<span aria-hidden="true">⬆︎</span>)을 누릅니다.
          </li>
          <li>“홈 화면에 추가”를 선택합니다.</li>
          <li>홈 화면의 WordFlip 아이콘으로 실행합니다.</li>
          <li>
            첫 접속과 데이터 불러오기를 마치면 오프라인에서도 사용할 수
            있습니다.
          </li>
        </ol>
        <p className="panel__note">
          설치와 오프라인 동작은 HTTPS 주소(예: GitHub Pages 배포 주소)에서
          정상 동작합니다.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel__title">학습 방법</h2>
        <ul className="help-list">
          <li>카드를 누르면 뒤집혀서 뜻과 예문이 보입니다.</li>
          <li>
            뒤집은 뒤 <strong>Again(다시) / Hard(어려움) / Good(알겠음) /
            Easy(쉬움)</strong> 버튼으로 평가합니다.
          </li>
          <li>
            스와이프로도 평가할 수 있습니다: ← Again, ↓ Hard, ↑ Good, → Easy
          </li>
          <li>
            잘 모르는 단어일수록 더 빨리 다시 나타나고, 쉬운 단어는 점점 늦게
            나타납니다.
          </li>
          <li>
            하루 제한이나 “오늘 학습 완료” 화면이 없습니다. 원할 때 원하는 만큼
            넘기면 됩니다.
          </li>
          <li>🔊 버튼을 누르면 기기 내장 음성으로 발음을 들을 수 있습니다.</li>
          <li>☆ 버튼으로 별표를 표시하고, 별표 카드만 모아 학습할 수 있습니다.</li>
        </ul>
      </section>

      <section className="panel">
        <h2 className="panel__title">학습 모드</h2>
        <ul className="help-list">
          <li>
            <strong>계속 학습</strong> — 복습 예정 카드와 신규 카드를 자동으로
            섞어 보여주는 기본 모드입니다.
          </li>
          <li>
            <strong>전체 둘러보기</strong> — 예정 여부와 상관없이 전체 카드를
            순서대로 끝없이 순환합니다.
          </li>
          <li>
            <strong>별표 학습</strong> — 별표를 표시한 카드만 학습합니다.
          </li>
          <li>
            <strong>검색 결과 학습</strong> — 단어 탭에서 검색한 뒤 “이 검색
            결과로 학습”을 누르면 해당 카드만 학습합니다.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2 className="panel__title">데이터와 백업</h2>
        <ul className="help-list">
          <li>모든 데이터는 이 기기의 브라우저(IndexedDB)에만 저장됩니다.</li>
          <li>서버, 계정, 광고, 추적 기능이 없습니다.</li>
          <li>
            데이터 탭에서 CSV 가져오기/내보내기와 JSON 전체 백업/복원을 할 수
            있습니다.
          </li>
          <li>
            iPhone에서 Safari 데이터를 지우면 학습 기록도 사라지므로, 가끔 JSON
            백업을 만들어 두세요.
          </li>
        </ul>
      </section>
    </div>
  );
}
