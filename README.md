# WordFlip — 오프라인 영어 단어 카드 PWA

하루 종일 심심할 때마다 열어서 영어 단어 카드를 넘기는 **개인용 오프라인 학습 앱**입니다.
iPhone Safari의 "홈 화면에 추가"로 설치하면 네트워크 없이도 모든 기능이 동작합니다.

- 서버 · 계정 · 로그인 · 광고 · 추적 · 외부 API **없음**
- 모든 데이터는 기기 안의 IndexedDB에만 저장
- 실제 경과 시간과 기억 상태를 반영하는 **FSRS-6** 간격 반복
- 8,524개 단어 내장 (필수 회화 표현 + 회화 어휘 + 학술/AI·CS/전문 어휘)

## 기능 요약

| 영역 | 내용 |
| --- | --- |
| 학습 모드 | 계속 학습(기본) · 전체 둘러보기 · 별표 학습 · 검색 결과 학습 |
| 평가 | 앞면의 `Good(알아요)`으로 즉시 다음 카드. 카드를 눌러 뜻을 본 뒤에는 `Again / Hard / Good / Easy` 중 선택 |
| 빠른 조작 | 답 공개 후 왼쪽 Again · 아래 Hard · 위 Good · 오른쪽 Easy 스와이프(설정에서 해제 가능) |
| 스케줄러 | FSRS-6: 실제 경과 시간, 카드별 난이도·안정성·회상 가능성, 목표 기억 유지율(기본 90%)로 다음 복습 계산 |
| 발음 | 기기 내장 음성(`speechSynthesis`). iPhone 효과음 음성을 제외하고 자연스러운 로컬 en-US 최우선 + 한글 발음 표기 |
| 데이터 | CSV 가져오기/내보내기, JSON 전체 백업/복원, 카드 추가·수정·삭제, 검색·필터 |
| 안전장치 | 원자적 복습 트랜잭션, 마지막 평가 되돌리기, 복습 로그로 스케줄 재계산, 중복 평가 방지 |
| PWA | 오프라인 precache(앱 셸 + words.csv), 새 버전 알림 후 사용자가 승인하면 업데이트 |

## 개발 환경에서 실행 (Ubuntu / Docker 컨테이너 내부)

```bash
cd wordflip
npm install
npm run dev        # vite --host 0.0.0.0 --port 5173 로 실행됨
```

- 개발 서버는 `0.0.0.0:5173`에 바인딩되므로 Docker 외부에서 `http://<호스트IP>:5173` 으로 접근할 수 있습니다.
- 같은 Wi-Fi의 iPhone Safari에서 `http://<호스트IP>:5173` 을 열면 레이아웃과 기본 동작을 확인할 수 있습니다.
  (HTTP 주소에서는 service worker가 등록되지 않으므로 **PWA 설치·오프라인 테스트는 아래 HTTPS 배포 주소 기준**으로 하세요.)

별도 컨테이너로 실행하고 싶다면:

```bash
docker compose up          # Dockerfile.dev 기반, 5173 포트 노출
```

기타 명령:

```bash
npm test           # Vitest 테스트 (스케줄러/큐/데이터/UI)
npm run typecheck  # TypeScript strict 검사
npm run build      # 테스트 통과 후 production build → dist/
npm run preview    # build 결과물 미리보기 (0.0.0.0:5173)
```

## GitHub Pages 무료 배포

1. **GitHub 저장소 생성** — github.com에서 새 공개(public) 저장소를 만듭니다. 예: `wordflip`
2. **프로젝트 push**

   ```bash
   cd wordflip
   git init
   git add .
   git commit -m "WordFlip initial commit"
   git branch -M main
   git remote add origin https://github.com/<사용자명>/<저장소명>.git
   git push -u origin main
   ```

3. **Settings → Pages** 로 이동합니다.
4. **Source를 "GitHub Actions"로 선택**합니다.
5. push 하면 `.github/workflows/deploy.yml` 워크플로가 자동 실행됩니다
   (테스트 → 빌드 → Pages 배포). Actions 탭에서 진행 상황을 볼 수 있습니다.
6. **배포 완료 후 HTTPS 주소 확인** — `https://<사용자명>.github.io/<저장소명>/`
   - 빌드 시 `BASE_PATH=/<저장소명>/` 이 자동 적용되어 하위 경로에서도 manifest,
     service worker, 아이콘, CSV 경로가 모두 올바르게 동작합니다.
7. **iPhone Safari로 주소 열기**
8. **홈 화면에 추가** (아래 참고)
9. **오프라인 실행 테스트** — 설치 후 앱을 한 번 실행해 데이터 로딩을 마친 뒤,
   비행기 모드를 켜고 홈 화면 아이콘으로 다시 실행해 보세요.

## iPhone 홈 화면 설치 방법

1. iPhone의 Safari에서 배포된 HTTPS 주소를 엽니다.
2. Safari의 공유 버튼(⬆︎)을 누릅니다.
3. "홈 화면에 추가"를 선택하고, 표시되면 "웹 앱으로 열기"를 켭니다.
4. 홈 화면의 WordFlip 아이콘으로 실행합니다.
5. 첫 접속과 데이터 불러오기를 마치면 오프라인에서도 사용할 수 있습니다.

> iPhone에서 Safari 웹사이트 데이터를 지우면 학습 기록도 함께 삭제됩니다.
> 데이터 탭의 **JSON 전체 백업**을 가끔 만들어 두세요.

## 스케줄러 동작 방식 (FSRS-6)

WordFlip은 Anki가 사용하는 현대적인 간격 반복 모델인 FSRS-6을 적용합니다.
각 카드의 **난이도(Difficulty)**, **안정성(Stability)**, 현재
**회상 가능성(Retrievability)**과 마지막 복습 뒤 실제로 흐른 시간을 함께 계산해
다음 복습 시각을 정합니다. 설정의 목표 기억 유지율은 기본 90%이며, 이후의 평가에
적용됩니다.

- 앞면에서 `Good(알아요)`을 누르면 정답을 확인하지 않고도 `Good`으로 기록한 뒤
  바로 다음 카드로 넘어갑니다.
- 카드를 누르는 동작은 뜻과 예문을 **보여주기만 하며 평가를 기록하지 않습니다**.
  답을 본 뒤 네 버튼 중 하나를 선택합니다.
  - `Again`: 기억하지 못함. 네 평가 중 유일한 실패입니다.
  - `Hard`: 힘들게 기억해 냄. 성공한 회상입니다.
  - `Good`: 기억해 냄. 일반적인 성공입니다.
  - `Easy`: 즉시, 확실하게 기억해 냄. 성공한 회상입니다.
- Anki식 10분 학습/재학습 단계를 사용합니다. 여기에 WordFlip의 짧은 세션용
  안전장치를 더해, `Again` 카드는 **10분이 지나고 다른 카드를 무작위 12~24장
  넘긴 뒤**에만 다시 나옵니다. 카드 수 조건은 FSRS 시각을 앞당기지 않고 너무
  이른 반복을 늦추는 방향으로만 작동합니다. 작은 별표/검색 덱에 대안 카드가
  전혀 없을 때는 멈춤을 막기 위해 10분 시간 조건만 적용합니다.
- 반복해서 잊는 카드는 난이도와 안정성 변화가 누적되어 자연스럽게 더 짧은 간격으로
  잡힙니다. 반대로 잘 기억하는 카드는 점점 더 긴 간격으로 이동합니다.
- 복습 시각이 된 카드를 신규 카드보다 먼저 보여줍니다. 복습 예정 카드도 신규
  카드도 없으면 아직 이르다고 미래 카드를 꺼내지 않고, 다음 복습 시각을 안내합니다.

엔진은 Open Spaced Repetition 프로젝트의
[`ts-fsrs` FSRS-6 구현](https://github.com/open-spaced-repetition/ts-fsrs)을 앱에
포함해 사용하므로 오프라인에서도 계산됩니다. 평가 의미와 설정 원칙은
[Anki 공식 FSRS 문서](https://docs.ankiweb.net/deck-options.html#fsrs)와
[Anki 공식 FSRS FAQ](https://faqs.ankiweb.net/frequently-asked-questions-about-fsrs.html)를
따릅니다.

## 단어 데이터

- `public/data/words.csv` — 8,524행. 스키마:

  ```csv
  id,word,part_of_speech,korean_meaning,korean_pronunciation,example_sentence,example_translation,category,difficulty,tags,starred
  ```

- 구성: 필수 회화 표현(phrasal verb·일상 표현, 상위 배치) → 회화 어휘(빈도순) →
  학술/AI·CS/전문 어휘
- 원본 출처는 `public/data/ATTRIBUTION.txt` 참고. 뜻과 예문은 개인 학습용으로
  전면 재검수했지만 사전 수준의 정확성을 보장하지는 않습니다. 발음은 TTS
  버튼을 기준으로 삼으세요.
- 데이터 탭에서 같은 스키마의 CSV를 가져오면 병합/교체할 수 있습니다.

## 폴더 구조

```
src/
  app/          앱 셸, 탭 내비게이션
  components/   StudyCard, SwipeCard, RatingButtons, StarButton, TtsButton ...
  pages/        학습 / 단어 목록 / 데이터 / 설정 / 안내
  db/           Dexie 스키마 · 마이그레이션
  scheduler/    FSRS-6 어댑터 + 검증
  queue/        카드 선택기 (순수 함수)
  services/     복습 트랜잭션 · CSV · 백업 · TTS
  stores/       앱 상태 저장소 (useSyncExternalStore)
  tests/        Vitest + Testing Library + fake-indexeddb
public/
  data/words.csv, icons/
.github/workflows/deploy.yml   GitHub Pages 자동 배포
```

## 알려진 제한사항

- iOS의 `speechSynthesis` 음성 목록은 첫 재생 후에 채워질 수 있습니다. 앱은
  캐릭터·효과음 음성을 자동 제외하고, 로컬 영어 음성이 있으면 원격 음성을 자동
  선택하지 않습니다. 최종 음질은 기기에 설치된 시스템 음성에 따라 다르며 설정
  탭에서 영어 음성을 직접 선택할 수도 있습니다.
- 오프라인 설치(서비스 워커)는 HTTPS(또는 localhost)에서만 동작합니다.
  로컬 IP HTTP 주소는 레이아웃 확인용입니다.
- 학습 데이터는 기기 브라우저 저장소에만 있습니다. 기기 간 동기화 기능은
  의도적으로 없습니다 (JSON 백업/복원으로 수동 이전).
- 한글 발음 표기와 뜻은 근사치입니다. 다의어는 대표 뜻 1–3개만 담았습니다.
