import { useEffect, useMemo, useState } from "react";
import { createPyodideEngine, type EngineStatus } from "./engine/engine";
import {
  emptyForm,
  formErrors,
  formToRules,
  type RulesForm,
} from "./rulesForm";
import type { Codebook, Rules, WorkbookInfo, VariableType } from "./types";
import DataFilePicker from "./components/DataFilePicker";
import ScreeningPage, { type ScreeningStatus } from "./pages/ScreeningPage";
import RulesPage from "./pages/RulesPage";
import VariableSetupPage from "./pages/VariableSetupPage";
import VariablesPage from "./pages/VariablesPage";
import {
  clearWorkspace,
  loadWorkspace,
  saveWorkspace,
  type Workspace,
} from "./workspace";
import "./App.css";

export interface DataFile {
  name: string;
  bytes: ArrayBuffer;
  info: WorkbookInfo;
  variableTypes?: Partial<Record<string, VariableType>>;
  // 코드를 적용하면 Analysis_Data 시트를 검사하고, 코드북과 원본 시트 이름을 함께 보관한다
  codebook?: Codebook;
  rawSheet?: string;
  editedCells?: number;
}

export interface RulesDraft {
  name: string;
  form: RulesForm;
}

// 규칙 편집 내용의 자동 저장 상태 (null: 이번에 아직 편집하지 않음)
export type AutoSave =
  | { state: "saved"; at: Date }
  | { state: "failed" }
  | null;

type Tab = "setup" | "rules" | "screening" | "summary";
const TABS: Tab[] = ["setup", "rules", "screening", "summary"];
const isTab = (value: unknown): value is Tab => TABS.includes(value as Tab);

const STEP_LABELS: Record<Tab, string> = {
  setup: "변수 설정",
  rules: "검사 규칙",
  screening: "스크리닝",
  summary: "내보내기",
};

type StepTone = "done" | "todo" | "warn" | "idle";

// 변수 하나에 건 검사를 규칙 하나로 센다 (ID 형식·중복 기준은 각각 하나)
function countRules(rules: Rules) {
  return (
    Object.keys(rules.numeric_columns ?? {}).length +
    Object.keys(rules.categorical_columns ?? {}).length +
    Object.keys(rules.date_columns ?? {}).length +
    (rules.cross_checks?.length ?? 0) +
    (rules.id_column ? 1 : 0) +
    (rules.duplicate_keys?.length ? 1 : 0)
  );
}

const DRAFT_KEY = "clinical-screening:rules-draft";
const WORKER_KEY = "clinical-screening:worker";

// 작업자 이름은 이 브라우저에 한 번 저장해 두고 Change_Log에 남긴다 (로그인이 없으므로)
function loadWorker() {
  try {
    return localStorage.getItem(WORKER_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveWorker(name: string) {
  try {
    localStorage.setItem(WORKER_KEY, name);
  } catch {
    // 저장소를 쓸 수 없으면 이번 화면에서만 쓴다
  }
}

function loadDraft(): RulesDraft {
  try {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) {
      const draft = JSON.parse(saved) as RulesDraft;
      // 예전에 저장한 초안에는 없는 항목(결측 허용 등)을 빈 값으로 채운다
      return { ...draft, form: { ...emptyForm(), ...draft.form } };
    }
  } catch {
    // 저장소를 쓸 수 없는 환경이면 빈 규칙으로 시작
  }
  return { name: "", form: emptyForm() };
}

function saveDraft(draft: RulesDraft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    // 개인정보 보호 모드 등 저장소를 쓸 수 없는 환경
    return false;
  }
}

// 이 브라우저에 보관된 지난 작업을 먼저 읽고 화면을 연다 (각 화면이 처음 값을 보관된 작업에서 가져오도록)
function App() {
  const [restored, setRestored] = useState<Workspace | null>(null);
  useEffect(() => {
    loadWorkspace().then(setRestored);
  }, []);
  if (!restored) {
    return (
      <div className="app">
        <p className="muted">이전 작업을 불러오는 중…</p>
      </div>
    );
  }
  return <Workbench initial={restored} />;
}

function Workbench({ initial }: { initial: Workspace }) {
  const [status, setStatus] = useState<EngineStatus>({
    state: "loading",
    message: "검사 엔진을 준비하는 중…",
  });
  const engine = useMemo(() => createPyodideEngine(setStatus), []);
  const [tab, setTab] = useState<Tab>(() =>
    initial.dataFile && isTab(initial.tab) ? initial.tab : "setup",
  );
  const [dataFile, setDataFile] = useState<DataFile | null>(initial.dataFile);
  const [draft, setDraft] = useState<RulesDraft>(loadDraft);
  const [autoSave, setAutoSave] = useState<AutoSave>(null);
  const [worker, setWorker] = useState(loadWorker);
  const [resumed, setResumed] = useState(Boolean(initial.dataFile));
  const [screening, setScreening] = useState<ScreeningStatus>({
    ran: false,
    issues: 0,
    pending: 0,
    busy: false,
  });
  // [새로 시작]하면 모든 화면을 처음 상태로 다시 연다
  const [session, setSession] = useState(0);

  // 올린 파일(고친 값 포함)과 보던 탭은 바뀔 때마다 이 브라우저에 보관한다
  useEffect(() => {
    saveWorkspace({ dataFile, tab });
  }, [dataFile, tab]);

  function startOver() {
    if (
      !confirm(
        "지금 작업을 지우고 새로 시작할까요? 내려받지 않은 수정 내용은 사라집니다. (규칙은 남습니다)",
      )
    )
      return;
    clearWorkspace();
    setDataFile(null);
    setTab("setup");
    setResumed(false);
    setSession((n) => n + 1);
  }

  function go(next: Tab) {
    setTab(next);
    window.scrollTo({ top: 0 });
  }

  const ruleErrors = formErrors(draft.form).length;
  const ruleCount = countRules(formToRules(draft.form));
  const steps: Record<Tab, { text: string; tone: StepTone }> = {
    setup: !dataFile
      ? { text: "파일 필요", tone: "idle" }
      : dataFile.codebook
        ? { text: "코드 적용됨", tone: "done" }
        : { text: "코드 적용 전", tone: "todo" },
    rules: ruleErrors
      ? { text: "입력 오류 있음", tone: "warn" }
      : ruleCount
        ? { text: `규칙 ${ruleCount}개`, tone: "done" }
        : { text: "규칙 없음", tone: "todo" },
    screening: !screening.ran
      ? { text: "아직 안 함", tone: dataFile ? "todo" : "idle" }
      : screening.pending
        ? { text: `반영 안 한 수정 ${screening.pending}건`, tone: "warn" }
        : screening.issues
          ? { text: `확인할 문제 ${screening.issues}건`, tone: "warn" }
          : { text: "문제 없음", tone: "done" },
    summary: dataFile
      ? { text: "받을 수 있음", tone: "todo" }
      : { text: "파일 필요", tone: "idle" },
  };
  const index = TABS.indexOf(tab);
  const prev = TABS[index - 1];
  const next = TABS[index + 1];

  // 규칙은 고칠 때마다 이 브라우저에 자동 저장되고, 스크리닝에도 바로 적용된다
  function updateDraft(next: RulesDraft) {
    setDraft(next);
    setAutoSave(
      saveDraft(next)
        ? { state: "saved", at: new Date() }
        : { state: "failed" },
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>임상 데이터 스크리닝</h1>
          <p className="muted">
            데이터는 이 PC의 브라우저 안에서만 검사되며 외부로 전송되지
            않습니다.
          </p>
        </div>
        <div className="header-side">
          <label className="inline small worker-field">
            작업자
            <input
              value={worker}
              placeholder="이름"
              aria-label="작업자 이름"
              onChange={(e) => {
                setWorker(e.target.value);
                saveWorker(e.target.value);
              }}
            />
          </label>
          <EngineBadge status={status} />
        </div>
      </header>

      {resumed && dataFile && (
        <div className="message save-status resume-notice">
          <span className="grow">
            <strong>이전 작업을 이어서 열었습니다: {dataFile.name}</strong>
            {dataFile.editedCells
              ? ` (반영한 수정 ${dataFile.editedCells}건)`
              : ""}
            . 작성하던 내용은 이 브라우저에 자동으로 보관됩니다.
          </span>
          <button className="button button-ghost" onClick={startOver}>
            새로 시작
          </button>
          <button
            className="icon-button"
            aria-label="안내 닫기"
            onClick={() => setResumed(false)}
          >
            ×
          </button>
        </div>
      )}

      {/* 단계는 순서대로 안내하지만 잠그지 않는다 (언제든 앞뒤로 옮겨 다닐 수 있다) */}
      <nav className="steps" aria-label="작업 단계">
        <ol>
          {TABS.map((t, i) => (
            <li key={t}>
              <button
                className={`step step-${steps[t].tone}`}
                aria-current={tab === t ? "step" : undefined}
                onClick={() => go(t)}
              >
                <span className="step-number">
                  {steps[t].tone === "done" ? "✓" : i + 1}
                </span>
                <span className="step-text">
                  <span className="step-label">{STEP_LABELS[t]}</span>
                  <span className="step-status">{steps[t].text}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {/* 데이터 파일은 모든 단계가 함께 쓰므로 맨 위에서 한 번만 고른다 */}
      <section className="card file-bar">
        <span className="file-bar-label">데이터 파일</span>
        <DataFilePicker
          engine={engine}
          ready={status.state === "ready" && !screening.busy}
          dataFile={dataFile}
          onDataFile={setDataFile}
        />
      </section>

      {/* 탭을 옮겨도 검사 결과와 고치던 값이 사라지지 않도록 모든 화면을 유지하고 숨기기만 한다 */}
      <main key={session}>
        <div hidden={tab !== "setup"}>
          <VariableSetupPage
            engine={engine}
            ready={status.state === "ready"}
            dataFile={dataFile}
            onDataFile={setDataFile}
            draft={draft}
            onDraft={updateDraft}
            onNext={() => go("rules")}
          />
        </div>
        <div hidden={tab !== "screening"}>
          <ScreeningPage
            engine={engine}
            ready={status.state === "ready"}
            dataFile={dataFile}
            onDataFile={setDataFile}
            draft={draft}
            onDraft={updateDraft}
            onEditRules={() => go("rules")}
            onGoToExport={() => go("summary")}
            worker={worker}
            onStatus={setScreening}
          />
        </div>
        <div hidden={tab !== "rules"}>
          <RulesPage
            engine={engine}
            ready={status.state === "ready"}
            dataFile={dataFile}
            draft={draft}
            onDraft={updateDraft}
            autoSave={autoSave}
            onStartScreening={() => go("screening")}
          />
        </div>
        <div hidden={tab !== "summary"}>
          <VariablesPage
            engine={engine}
            ready={status.state === "ready"}
            dataFile={dataFile}
            onDataFile={setDataFile}
            draft={draft}
            onGoToSetup={() => go("setup")}
            pendingEdits={screening.pending}
            onGoToScreening={() => go("screening")}
          />
        </div>
      </main>

      <div className="step-nav">
        {prev && (
          <button className="button button-ghost" onClick={() => go(prev)}>
            ← 이전: {STEP_LABELS[prev]}
          </button>
        )}
        <span className="grow" />
        {next && (
          <button className="button" onClick={() => go(next)}>
            다음: {STEP_LABELS[next]} →
          </button>
        )}
      </div>
    </div>
  );
}

function EngineBadge({ status }: { status: EngineStatus }) {
  if (status.state === "ready")
    return <span className="badge badge-ok">검사 엔진 준비됨</span>;
  if (status.state === "failed")
    return (
      <span className="badge badge-error" title={status.message}>
        검사 엔진 오류
      </span>
    );
  return <span className="badge badge-loading">{status.message}</span>;
}

export default App;
