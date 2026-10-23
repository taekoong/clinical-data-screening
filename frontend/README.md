# 임상 데이터 스크리닝 (웹)

엑셀 원본 데이터를 브라우저 안에서 검사하는 화면입니다. 검사 로직은 `backend/src/`의 Python 코드를
[Pyodide](https://pyodide.org)로 브라우저에서 그대로 실행하므로, 터미널(`python3 backend/src/main.py`)과 결과가 같습니다.
데이터는 사용자 PC의 브라우저 밖으로 전송되지 않습니다.

## 개발

```bash
npm install
npm run dev          # http://localhost:5173
```

`npm run dev`와 `npm run build`는 시작 전에 `prepare:pyodide`를 자동 실행해
Pyodide와 Python 패키지(pandas, openpyxl 등, 약 23MB)를 `public/pyodide/`에 내려받습니다.
처음 한 번만 인터넷이 필요하고, 이후에는 해시가 같으면 다시 받지 않습니다.

## NAS에 배포

```bash
npm run build
```

`dist/` 폴더 안의 내용 전체를 NAS 웹 폴더(예: Synology Web Station의 `web/screening/`)에 복사합니다.
경로는 모두 상대 경로라 어느 폴더에 두어도 됩니다.

- 반드시 `http://NAS주소/screening/`처럼 **웹 주소로 열어야** 합니다.
  공유 폴더에서 `index.html`을 더블클릭(`file://`)하면 브라우저 보안 제한 때문에 검사 엔진이 동작하지 않습니다.
- 앱에 필요한 파일이 모두 포함되어 있어 NAS가 인터넷에 연결되어 있지 않아도 됩니다.
- 첫 접속 때 약 23MB를 받고, 이후에는 브라우저 캐시를 사용합니다.

## 데이터 수정

검사 결과 표의 수정값 칸에서 값을 고치고 [반영하고 다시 검사]를 누르면, 고친 파일로 다시 검사합니다.
[수정한 파일 저장]은 원본 엑셀(서식, 다른 시트 포함)에 고친 값을 넣은 `*_corrected.xlsx`를 내려받습니다.
수정 시각, 셀, 수정 전·후 값, 문제 유형은 같은 파일의 `Change_Log` 시트에 쌓입니다.

## 규칙 파일 공유

규칙 편집 탭에서 만든 규칙은 [규칙 파일 저장]으로 JSON 파일을 내려받습니다.
NAS 공유 폴더에 두면 다른 연구자가 [규칙 파일 불러오기]로 사용할 수 있고,
같은 파일을 터미널에서도 `--rules`로 쓸 수 있습니다.

## 검증

```bash
npm run check:pyodide   # Pyodide 결과가 data/test_all_checks.xlsx 정답표와 같은지 확인
```

Python 쪽 테스트는 프로젝트 루트에서 `python3 -m pytest backend/tests`로 실행합니다.

## 구조

| 경로 | 역할 |
|---|---|
| `src/engine/` | 화면과 검사 엔진 사이 연결. `ScreeningEngine` 인터페이스만 화면에서 사용하므로, 나중에 서버 방식으로 바꿀 때 이 부분만 교체 |
| `src/engine/pyodide.worker.ts` | Web Worker에서 Pyodide 실행 (검사 중에도 화면이 멈추지 않음) |
| `src/engine/web_api.py` | 브라우저에서 호출하는 Python 진입점 |
| `src/pages/` | 스크리닝, 규칙 편집 화면 |
| `src/rulesForm.ts` | 규칙 편집 화면 ↔ 규칙 JSON 변환, 데이터로 규칙 초안 만들기 |
| `scripts/` | Pyodide 파일 준비, Pyodide 결과 검증 |
