import { useEffect, useMemo, useState } from "react";
import { createPyodideEngine, type EngineStatus } from "./engine/engine";
import { emptyForm, type RulesForm } from "./rulesForm";
import type { Codebook, WorkbookInfo, VariableType } from "./types";
import ScreeningPage from "./pages/ScreeningPage";
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

const DRAFT_KEY = "clinical-screening:rules-draft";

function loadDraft(): RulesDraft {
  try {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) return JSON.parse(saved);
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
  const [resumed, setResumed] = useState(Boolean(initial.dataFile));
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
        <EngineBadge status={status} />
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

      <nav className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "setup"}
          onClick={() => setTab("setup")}
        >
          변수 설정
        </button>
        <button
          role="tab"
          aria-selected={tab === "rules"}
          onClick={() => setTab("rules")}
        >
          규칙 편집
        </button>
        <button
          role="tab"
          aria-selected={tab === "screening"}
          onClick={() => setTab("screening")}
        >
          스크리닝
        </button>
        <button
          role="tab"
          aria-selected={tab === "summary"}
          onClick={() => setTab("summary")}
        >
          요약·코딩
        </button>
      </nav>

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
            onNext={() => setTab("rules")}
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
            onEditRules={() => setTab("rules")}
          />
        </div>
        <div hidden={tab !== "rules"}>
          <RulesPage
            engine={engine}
            ready={status.state === "ready"}
            dataFile={dataFile}
            onDataFile={setDataFile}
            draft={draft}
            onDraft={updateDraft}
            autoSave={autoSave}
            onStartScreening={() => setTab("screening")}
          />
        </div>
        <div hidden={tab !== "summary"}>
          <VariablesPage
            engine={engine}
            ready={status.state === "ready"}
            dataFile={dataFile}
            onDataFile={setDataFile}
            draft={draft}
            onGoToSetup={() => setTab("setup")}
          />
        </div>
      </main>
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
