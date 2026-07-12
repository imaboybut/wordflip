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
          <li>
            “홈 화면에 추가”를 선택하고, 표시되면 “웹 앱으로 열기”를 켭니다.
          </li>
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
          <li>
            단어를 알면 앞면 아래의 <strong>Good(알아요)</strong>을 누릅니다.
            Good으로 기록되고 바로 다음 카드로 넘어갑니다.
          </li>
          <li>
            답을 확인하려면 카드를 누릅니다. 뜻과 예문만 보이며, 이때는 아직
            평가가 기록되지 않습니다.
          </li>
          <li>
            답을 본 뒤 <strong>Again / Hard / Good / Easy</strong> 중 하나를
            선택하면 다음 카드로 넘어갑니다. Again은 기억하지 못함, Hard는
            힘들게 기억함, Good은 기억함, Easy는 즉시 기억함입니다. 네 평가 중
            실패는 Again뿐입니다.
          </li>
          <li>
            답을 공개한 뒤에는 버튼 대신 왼쪽(Again) · 아래(Hard) · 위(Good) ·
            오른쪽(Easy)으로 스와이프해도 됩니다. 설정에서 끌 수 있습니다.
          </li>
          <li>
            FSRS-6이 실제 경과 시간과 카드별 난이도·안정성·회상 가능성을
            계산해 다음 복습 시각을 정합니다. 목표 기억 유지율의 기본값은
            90%입니다.
          </li>
          <li>
            Again 카드는 10분이 지난 뒤에도 다른 카드를 무작위 12~24장 정도
            넘긴 후에 다시 나옵니다. 카드 수 조건은 FSRS 복습 시각을 앞당기지
            않고 너무 이른 반복을 늦추는 용도로만 작동합니다. 학습할 다른 카드가
            전혀 없는 작은 덱에서는 멈추지 않도록 10분 조건만 적용합니다.
          </li>
          <li>
            반복해서 잊는 카드는 자연스럽게 더 짧은 간격으로, 잘 기억하는 카드는
            더 긴 간격으로 잡힙니다.
          </li>
          <li>
            복습 시각이 된 카드를 신규 카드보다 먼저 보여줍니다. 둘 다 없으면
            미래 카드를 미리 보여주지 않고 다음 복습 시각을 안내합니다.
          </li>
          <li>
            🔊 버튼을 누르면 기기 내장 음성으로 발음을 들을 수 있습니다. 자동
            모드는 iPhone의 효과음 음성을 제외하고 자연스러운 영어 음성을
            우선합니다.
          </li>
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
