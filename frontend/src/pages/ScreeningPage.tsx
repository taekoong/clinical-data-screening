import { useEffect, useMemo, useState } from "react";
import type { DataFile, RulesDraft } from "../App";
import DataFilePicker from "../components/DataFilePicker";
import { parseCell, type CellPos } from "../cells";
import DataGrid from "../components/DataGrid";
import ValueText from "../components/ValueText";
import RulesFileButton from "../components/RulesFileButton";
import RecodePanel from "../components/RecodePanel";
import type { ScreeningEngine } from "../engine/engine";
import { downloadBlob, errorText, fileStem } from "../files";
import { isNumericIssue, issueLabel, SEVERITY_LABELS } from "../issueTypes";
import { formErrors, formToRules } from "../rulesForm";
import {
  SEVERITIES,
  type CellEdit,
  type Issue,
  type ScreeningResult,
  type Severity,
  type WorkbookInfo,
  type VariableType,
} from "../types";

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface Props {
  engine: ScreeningEngine;
  ready: boolean;
  dataFile: DataFile | null;
  onDataFile: (file: DataFile | null) => void;
  draft: RulesDraft;
  onDraft: (draft: RulesDraft) => void;
  onEditRules: () => void;
}

interface Run {
  file: DataFile;
  result: ScreeningResult;
}

// 셀 주소 → 고친 값
type Edits = Record<string, string>;

export default function ScreeningPage({
  engine,
  ready,
  dataFile,
  onDataFile,
  draft,
  onDraft,
  onEditRules,
}: Props) {
  const [useRules, setUseRules] = useState(true);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [edits, setEdits] = useState<Edits>({});
  const [applying, setApplying] = useState(false);
  const [editError, setEditError] = useState("");
  const [unsaved, setUnsaved] = useState(false);
  const [recoding, setRecoding] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [summaryRun, setSummaryRun] = useState<{
    file: DataFile;
    results: WorkbookInfo["continuous_summary"];
  } | null>(null);

  const rules = useMemo(() => formToRules(draft.form), [draft.form]);
  const ruleCount = Object.keys(rules).length;
  const pendingCount = Object.keys(edits).length;

  // 고친 내용을 저장하지 않고 창을 닫으려 하면 확인 창 띄우기
  useEffect(() => {
    if (!unsaved && !pendingCount) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved, pendingCount]);

  async function summarize() {
    if (!dataFile || summarizing) return;
    const file = dataFile;

    setSummarizing(true);
    setSummaryError("");
    setSummaryRun(null);

    try {
      const info = await engine.inspect(
        file.bytes,
        file.info.sheet,
        file.variableTypes,
      );

      setSummaryRun({
        file,
        results: info.continuous_summary,
      });
    } catch (e) {
      setSummaryError(`요약 계산에 실패했습니다: ${errorText(e)}`);
    } finally {
      setSummarizing(false);
    }
  }

  async function screen(file: DataFile) {
    setRunning(true);
    setErrors([]);
    try {
      const inputErrors = useRules ? formErrors(draft.form) : [];
      if (inputErrors.length) {
        setErrors(inputErrors);
        return;
      }
      const outcome = await engine.screen(
        file.bytes,
        useRules && ruleCount ? rules : null,
        file.info.sheet,
      );
      if (outcome.ok) setRun({ file, result: outcome.result });
      else setErrors(outcome.ruleErrors);
    } catch (e) {
      setErrors([`검사 중 오류가 발생했습니다: ${errorText(e)}`]);
    } finally {
      setRunning(false);
    }
  }

  function start() {
    if (!dataFile) return;
    if (
      pendingCount &&
      !confirm(`반영하지 않은 수정 ${pendingCount}건이 사라집니다. 계속할까요?`)
    )
      return;
    setEdits({});
    setEditError("");
    setUnsaved(Boolean(dataFile.editedCells));
    screen(dataFile);
  }

  function editCell(cell: string, value: string, original: string) {
    setEdits((current) => {
      const next = { ...current };
      if (value === original) delete next[cell];
      else next[cell] = value;
      return next;
    });
  }

  async function applyEdits(): Promise<DataFile | null> {
    if (!run) return null;
    if (!pendingCount) return run.file;

    setApplying(true);
    setEditError("");
    try {
      const issuesByCell = new Map<string, Set<string>>();
      for (const issue of run.result.issues) {
        if (!issuesByCell.has(issue.Cell))
          issuesByCell.set(issue.Cell, new Set());
        issuesByCell.get(issue.Cell)!.add(issue.Issue_Type);
      }
      const list: CellEdit[] = Object.entries(edits).map(([cell, value]) => ({
        cell,
        value,
        issue: [...(issuesByCell.get(cell) ?? [])].join(", "),
      }));

      const { sheet } = run.result;
      const bytes = await engine.applyEdits(run.file.bytes, sheet, list);
      const file: DataFile = {
        name: run.file.name,
        bytes,
        info: await engine.inspect(bytes, sheet),
        variableTypes:
          dataFile?.bytes === run.file.bytes && dataFile?.info.sheet === sheet
            ? dataFile.variableTypes
            : run.file.variableTypes,
        editedCells: (run.file.editedCells ?? 0) + list.length,
      };

      onDataFile(file);
      setRun({ file, result: run.result });
      setUnsaved(true);

      await screen(file);
      setEdits({});
      return file;
    } catch (e) {
      setEditError(`수정 내용을 반영하지 못했습니다: ${errorText(e)}`);
      return null;
    } finally {
      setApplying(false);
    }
  }

  async function save() {
    const file = await applyEdits();
    if (!file) return;
    const stem = fileStem(file.name).replace(/_corrected$/, "");
    downloadBlob(
      new Blob([file.bytes], { type: XLSX_TYPE }),
      `${stem}_corrected.xlsx`,
    );
    setUnsaved(false);
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>1. 데이터 파일</h2>
        <DataFilePicker
          engine={engine}
          ready={ready && !recoding}
          dataFile={dataFile}
          onDataFile={onDataFile}
        />
        {dataFile && (
          <div>
            <h3>변수별 데이터 요약</h3>
            <p className="muted">
              전체 {dataFile.info.column_count}개 변수 중{" "}
              {Object.keys(dataFile.variableTypes ?? {}).length}개 유형 지정
              완료
            </p>
            {dataFile.info.columns.map((profile) => (
              <p key={profile.column}>
                {profile.column}: pandas 자료형 {profile.dtype} · 추정 유형{" "}
                {profile.type} 결측 {profile.missing}개 (
                {profile.missing_percent}%) · 고유값 {profile.unique}개
                {profile.values && (
                  <span>
                    {" · 값 분포: "}{" "}
                    {Object.entries(profile.values)
                      .map(([value, count]) => `${value}: ${count}개`)
                      .join(", ")}
                  </span>
                )}
                {profile.invalid !== undefined && profile.invalid > 0 && (
                  <span>
                    {" · 잘못된 값: "} {profile.invalid}개
                  </span>
                )}
                {profile.min !== undefined && profile.max !== undefined && (
                  <span>
                    {" · 관측 범위: "}
                    {profile.min} ~ {profile.max}
                  </span>
                )}
                <label>
                  {" · 연구자 지정: "}
                  <select
                    disabled={recoding}
                    value={dataFile.variableTypes?.[profile.column] ?? ""}
                    onChange={(e) => {
                      const selected = e.target.value;
                      const nextTypes = { ...dataFile.variableTypes };

                      if (selected === "") {
                        delete nextTypes[profile.column];
                      } else {
                        nextTypes[profile.column] = selected as VariableType;
                      }

                      onDataFile({
                        ...dataFile,
                        variableTypes: nextTypes,
                      });
                    }}
                  >
                    <option value="">Unspecified</option>
                    <option value="identifier">Identifier</option>
                    <option value="continuous">Continuous</option>
                    <option value="categorical">Categorical</option>
                    <option value="date">Date</option>
                    <option value="text">Text</option>
                  </select>
                </label>
              </p>
            ))}

            <button
              className="button button-primary"
              onClick={summarize}
              disabled={
                !ready ||
                summarizing ||
                applying ||
                recoding ||
                !Object.values(dataFile.variableTypes ?? {}).includes(
                  "continuous",
                )
              }
            >
              {summarizing ? "계산 중…" : "연속형 변수 요약 계산"}
            </button>

            {summaryError && (
              <p className="message message-error">{summaryError}</p>
            )}

            {summaryRun && summaryRun.file === dataFile && (
              <div>
                <h3>연속형 변수 요약</h3>
                <p className="muted">
                  결측과 변환 불가 값은 제외하며, 숫자로 읽히는 극단값은
                  포함합니다.
                </p>
                {Object.entries(summaryRun.results).map(([column, result]) =>
                  result ? (
                    <p key={column}>
                      {column}: 계산 가능 {result.valid_count}개 · 변환 불가{" "}
                      {result.invalid_count}개 · 평균{" "}
                      {result.mean?.toFixed(2) ?? "계산 불가"} · 중앙값{" "}
                      {result.median?.toFixed(2) ?? "계산 불가"}
                      {" · 표준편차 "}
                      {result.std?.toFixed(2) ?? "계산 불가"}
                    </p>
                  ) : null,
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>2. 검사 규칙</h2>
        <div className="picker">
          <label className="inline">
            <input
              type="checkbox"
              checked={useRules}
              onChange={(e) => setUseRules(e.target.checked)}
            />
            연구별 규칙 적용
          </label>
          {useRules && (
            <>
              <span className="file-name">
                {ruleCount ? draft.name || "이름 없는 규칙" : "규칙 없음"}
              </span>
              <RulesFileButton onLoad={onDraft} />
              <button className="button button-ghost" onClick={onEditRules}>
                규칙 편집
              </button>
            </>
          )}
        </div>
        <p className="muted">
          {useRules && ruleCount
            ? `규칙 항목 ${ruleCount}개가 적용됩니다. 규칙에 없는 컬럼도 공통 검사(결측, 공백, 숫자 오타 등)는 받습니다.`
            : "공통 검사(결측, 공백, 숫자 오타, 표기 차이)만 실행합니다."}
        </p>
      </section>

      <div>
        <button
          className="button button-primary"
          disabled={!ready || !dataFile || running || recoding}
          onClick={start}
        >
          {running ? "검사 중…" : "스크리닝 실행"}
        </button>
      </div>

      {errors.length > 0 && (
        <div className="message message-error">
          <strong>검사를 실행하지 못했습니다.</strong>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {run && (
        <Results
          run={run}
          currentFile={dataFile?.bytes === run.file.bytes && dataFile.info.sheet === run.result.sheet ? dataFile : null}
          engine={engine}
          onRecodeBusy={setRecoding}
          recodeDisabled={!ready || summarizing}
          onRecodeApplied={async (file) => {
            onDataFile(file);
            setRun(null);
            setEdits({});
            setEditError("");
            setSummaryRun(null);
            setUnsaved(true);
            await screen(file);
          }}
          edits={edits}
          busy={applying || running || recoding}
          editError={editError}
          onEdit={editCell}
          onDiscard={() => setEdits({})}
          onApply={applyEdits}
          onSave={save}
        />
      )}
    </div>
  );
}

const PAGE_SIZE = 200;

interface ResultsProps {
  run: Run;
  currentFile: DataFile | null;
  engine: ScreeningEngine;
  onRecodeBusy: (busy: boolean) => void;
  recodeDisabled: boolean;
  onRecodeApplied: (file: DataFile) => Promise<void>;
  edits: Edits;
  busy: boolean;
  editError: string;
  onEdit: (cell: string, value: string, original: string) => void;
  onDiscard: () => void;
  onApply: () => void;
  onSave: () => void;
}

function Results({
  run,
  currentFile,
  engine,
  onRecodeBusy,
  recodeDisabled,
  onRecodeApplied,
  edits,
  busy,
  editError,
  onEdit,
  onDiscard,
  onApply,
  onSave,
}: ResultsProps) {
  const { result } = run;
  const pendingCount = Object.keys(edits).length;
  const editedCells = run.file.editedCells ?? 0;
  const [severities, setSeverities] = useState<Set<Severity>>(
    new Set(["ERROR", "REVIEW"]),
  );
  const [issueType, setIssueType] = useState("");
  const [column, setColumn] = useState("");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<CellPos | null>(null);
  const [bulk, setBulk] = useState<{ column: string; source: string; bytes: ArrayBuffer; sheet: string } | null>(null);

  const issueTypes = useMemo(
    () => [...new Set(result.issues.map((i) => i.Issue_Type))],
    [result],
  );
  const columns = useMemo(
    () => [...new Set(result.issues.map((i) => i.Column))],
    [result],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const order = { ERROR: 0, REVIEW: 1, INFO: 2 };
    return result.issues
      .filter((i) => severities.has(i.Severity))
      .filter((i) => !issueType || i.Issue_Type === issueType)
      .filter((i) => !column || i.Column === column)
      .filter(
        (i) =>
          !q ||
          [i.Cell, i.Original_Value, i.Description].some((t) =>
            t.toLowerCase().includes(q),
          ),
      )
      .sort(
        (a, b) =>
          order[a.Severity] - order[b.Severity] || a.Excel_Row - b.Excel_Row,
      );
  }, [result, severities, issueType, column, query]);

  function toggle(severity: Severity) {
    const next = new Set(severities);
    if (next.has(severity)) next.delete(severity);
    else next.add(severity);
    setSeverities(next);
    setShown(PAGE_SIZE);
  }

  // 문제 목록에서 셀을 누르면 데이터 표로 가서 그 셀을 선택
  function showInGrid(issue: Issue) {
    setSelected(parseCell(issue.Cell));
    setView("grid");
  }

  function download() {
    const blob = new Blob([result.report as BlobPart], { type: XLSX_TYPE });
    downloadBlob(blob, `${fileStem(run.file.name)}_screening.xlsx`);
  }

  return (
    <section className="card">
      <div className="results-header">
        <h2>
          검사 결과{" "}
          <span className="muted">
            · {run.file.name} / {result.sheet}
          </span>
        </h2>
        <div className="toolbar">
          <button className="button" onClick={download} disabled={busy}>
            결과 엑셀 다운로드
          </button>
          <button
            className="button button-primary"
            onClick={onSave}
            disabled={busy || (!pendingCount && !editedCells)}
          >
            수정한 파일 저장
          </button>
        </div>
      </div>

      {(pendingCount > 0 || editedCells > 0) && (
        <div className="edit-bar">
          <span className="grow">
            {pendingCount > 0
              ? `고친 셀 ${pendingCount}개가 아직 반영되지 않았습니다.`
              : `이 파일에 수정 ${editedCells}건이 반영되어 있습니다.`}{" "}
            <span className="muted">
              저장한 파일의 Change_Log 시트에 수정 전·후 값이 기록됩니다.
            </span>
          </span>
          {pendingCount > 0 && (
            <>
              <button
                className="button button-ghost"
                onClick={onDiscard}
                disabled={busy}
              >
                수정 취소
              </button>
              <button className="button" onClick={onApply} disabled={busy}>
                {busy ? "반영하는 중…" : "반영하고 다시 검사"}
              </button>
            </>
          )}
        </div>
      )}

      {editError && <p className="message message-error">{editError}</p>}

      <div className="stats">
        <Stat label="검사한 행" value={result.summary.total_rows} />
        <Stat label="발견한 문제" value={result.summary.issue_count} />
        {SEVERITIES.map((s) => (
          <Stat
            key={s}
            label={SEVERITY_LABELS[s]}
            value={result.summary.by_severity[s]}
            tone={s}
          />
        ))}
      </div>

      {result.warnings.length > 0 && (
        <div className="message message-warning">
          <strong>건너뛴 검사가 있습니다.</strong>
          <ul>
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="segmented" role="tablist">
        <button
          role="tab"
          aria-selected={view === "grid"}
          onClick={() => setView("grid")}
        >
          데이터 표
        </button>
        <button
          role="tab"
          aria-selected={view === "list"}
          onClick={() => setView("list")}
        >
          문제 목록 {result.issues.length}
        </button>
      </div>

      {view === "grid" ? (
        <>
        {bulk && currentFile && bulk.bytes === currentFile.bytes && bulk.sheet === currentFile.info.sheet && (
          <RecodePanel
            key={`${bulk.sheet}:${bulk.column}:${bulk.source}`}
            file={currentFile}
            engine={engine}
            column={bulk.column}
            initialSource={bulk.source}
            onClose={() => setBulk(null)}
            disabled={busy || recodeDisabled || pendingCount > 0}
            pendingEdits={pendingCount > 0}
            onBusy={onRecodeBusy}
            onApplied={onRecodeApplied}
          />
        )}
        <DataGrid
          table={result.table}
          issues={result.issues}
          edits={edits}
          selected={selected}
          disabled={busy}
          onSelect={setSelected}
          onEdit={onEdit}
          onBulkChange={currentFile ? (column, source) => setBulk({ column, source, bytes: currentFile.bytes, sheet: currentFile.info.sheet }) : undefined}
        />
        </>
      ) : result.issues.length === 0 ? (
        <p className="message message-ok">발견된 문제가 없습니다.</p>
      ) : (
        <>
          <div className="filters">
            {SEVERITIES.map((s) => (
              <button
                key={s}
                className={`chip chip-${s} ${severities.has(s) ? "on" : ""}`}
                aria-pressed={severities.has(s)}
                onClick={() => toggle(s)}
              >
                {SEVERITY_LABELS[s]} {result.summary.by_severity[s]}
              </button>
            ))}
            <select
              value={issueType}
              onChange={(e) => setIssueType(e.target.value)}
            >
              <option value="">모든 문제 유형</option>
              {issueTypes.map((t) => (
                <option key={t} value={t}>
                  {issueLabel(t)}
                </option>
              ))}
            </select>
            <select value={column} onChange={(e) => setColumn(e.target.value)}>
              <option value="">모든 컬럼</option>
              {columns.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input
              type="search"
              placeholder="셀, 값, 설명 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <p className="muted">
            {filtered.length}건 표시 · 셀 주소를 누르면 데이터 표에서 주변 값과
            함께 볼 수 있습니다.
          </p>
          <IssueTable
            issues={filtered.slice(0, shown)}
            edits={edits}
            disabled={busy}
            onEdit={onEdit}
            onShow={showInGrid}
          />
          {filtered.length > shown && (
            <button
              className="button button-ghost"
              onClick={() => setShown(shown + PAGE_SIZE)}
            >
              {Math.min(PAGE_SIZE, filtered.length - shown)}건 더 보기 (남은{" "}
              {filtered.length - shown}건)
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: Severity;
}) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <span className="stat-value">{value.toLocaleString()}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

interface IssueTableProps {
  issues: Issue[];
  edits: Edits;
  disabled: boolean;
  onEdit: (cell: string, value: string, original: string) => void;
  onShow: (issue: Issue) => void;
}

function IssueTable({
  issues,
  edits,
  disabled,
  onEdit,
  onShow,
}: IssueTableProps) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>등급</th>
            <th>셀</th>
            <th>컬럼</th>
            <th>값</th>
            <th>수정값</th>
            <th>문제 유형</th>
            <th>설명</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue, i) => (
            <tr key={`${issue.Cell}-${issue.Issue_Type}-${i}`}>
              <td>
                <span className={`severity severity-${issue.Severity}`}>
                  {SEVERITY_LABELS[issue.Severity]}
                </span>
              </td>
              <td className="mono">
                {issue.Excel_Row > 1 ? (
                  <button
                    className="link-button"
                    onClick={() => onShow(issue)}
                    title="데이터 표에서 보기"
                    aria-label={`${issue.Cell} 데이터 표에서 보기`}
                  >
                    {issue.Cell}
                  </button>
                ) : (
                  issue.Cell
                )}
              </td>
              <td>{issue.Column}</td>
              <td className="mono value">
                <ValueText
                  value={issue.Original_Value}
                  numeric={isNumericIssue(issue.Issue_Type)}
                />
              </td>
              <td>
                {/* 1행은 머리글이라 고칠 수 없다 (빈 컬럼 문제) */}
                {issue.Excel_Row > 1 ? (
                  <EditCell
                    issue={issue}
                    value={edits[issue.Cell]}
                    disabled={disabled}
                    onEdit={onEdit}
                  />
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>{issueLabel(issue.Issue_Type)}</td>
              <td>{issue.Description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 같은 셀에 문제가 여러 개면 입력칸도 여러 줄에 나오지만 값은 하나로 묶여 함께 바뀐다
function EditCell({
  issue,
  value,
  disabled,
  onEdit,
}: {
  issue: Issue;
  value: string | undefined;
  disabled: boolean;
  onEdit: (cell: string, value: string, original: string) => void;
}) {
  const edited = value !== undefined;
  const original = issue.Original_Value;

  return (
    <div className="edit-cell">
      <input
        className={`mono ${edited ? "edited" : ""}`}
        value={value ?? original}
        placeholder="(빈 값)"
        aria-label={`${issue.Cell} 수정값`}
        disabled={disabled}
        onChange={(e) => onEdit(issue.Cell, e.target.value, original)}
        onKeyDown={(e) =>
          e.key === "Escape" && onEdit(issue.Cell, original, original)
        }
      />
      {edited && (
        <button
          className="icon-button"
          aria-label={`${issue.Cell} 원래 값으로`}
          title="원래 값으로"
          disabled={disabled}
          onClick={() => onEdit(issue.Cell, original, original)}
        >
          ↺
        </button>
      )}
    </div>
  );
}
