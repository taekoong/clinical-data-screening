import { useState, type KeyboardEvent } from "react";
import type { DataFile, RulesDraft } from "../App";
import type { ScreeningEngine } from "../engine/engine";
import { getRange, setAllowMissing, type RulesForm } from "../rulesForm";
import type {
  CodeLevel,
  ColumnProfile,
  VariableType,
  Codebook,
} from "../types";
import ValueText from "../components/ValueText";
import { errorText } from "../files";
import {
  checkRows,
  defaultRows,
  inferredType,
  inputsFromCodebook,
  orderedColumns,
  rowsToLevels,
  TYPE_HELP,
  TYPE_LABELS,
  type CodeInputs,
  type CodeRow,
} from "../variablesPlan";
import { saveWorkspace, savedWorkspace, setupKey } from "../workspace";

const TYPES = Object.keys(TYPE_LABELS) as VariableType[];
const ANALYSIS_SHEET = "Analysis_Data";

interface Props {
  engine: ScreeningEngine;
  ready: boolean;
  dataFile: DataFile | null;
  onDataFile: (file: DataFile | null) => void;
  // 결측 허용은 검사 규칙과 같은 값이고, 허용 범위는 보여 주기만 한다
  draft: RulesDraft;
  onDraft: (draft: RulesDraft) => void;
  onNext: () => void;
}

export default function VariableSetupPage({
  engine,
  ready,
  dataFile,
  onDataFile,
  draft,
  onDraft,
  onNext,
}: Props) {
  return (
    <div className="stack">
      {!dataFile && (
        <section className="card">
          <h2>변수 설정</h2>
          <p className="muted">
            {ready
              ? "위의 [엑셀 파일 선택]으로 데이터를 올리면 변수마다 유형과 값을 정할 수 있습니다."
              : "검사 엔진을 준비하는 중입니다. 잠시 후 위에서 엑셀 파일을 고르세요."}
          </p>
        </section>
      )}
      {/* 다른 파일이나 시트를 고르면 보고 있던 변수를 새로 고른다 */}
      {dataFile && (
        <Setup
          key={`${dataFile.name}:${dataFile.rawSheet ?? dataFile.info.sheet}`}
          engine={engine}
          dataFile={dataFile}
          onDataFile={onDataFile}
          draft={draft}
          onDraft={onDraft}
          onNext={onNext}
        />
      )}
    </div>
  );
}

const rowId = (column: string) => `setup-row-${encodeURIComponent(column)}`;

function Setup({
  engine,
  dataFile,
  onDataFile,
  draft,
  onDraft,
  onNext,
}: Pick<Props, "engine" | "onDataFile" | "draft" | "onDraft" | "onNext"> & {
  dataFile: DataFile;
}) {
  const profiles = dataFile.info.columns;
  const [active, setActive] = useState(profiles[0]?.column ?? "");
  // 코드를 적용했으면 그 코드북으로, 아니면 새로고침 전에 입력하던 값으로 시작한다
  const [codeInputs, setCodeInputs] = useState<CodeInputs>(() => {
    if (dataFile.codebook) return inputsFromCodebook(dataFile.codebook);
    const saved = savedWorkspace().codeInputs;
    return saved?.fileKey === setupKey(dataFile) ? saved.inputs : {};
  });
  // 순서형으로 체크한 변수 (코드가 작은 값부터 순서대로)
  const [ordered, setOrdered] = useState<Set<string>>(() => {
    if (dataFile.codebook) return orderedColumns(dataFile.codebook);
    const saved = savedWorkspace().codeInputs;
    return new Set(saved?.fileKey === setupKey(dataFile) ? saved.ordered : []);
  });
  // 코드북이 있는 변수: 코드북에 없던 값은 일부러 비워 둔 것이므로 기본 코드를 붙이지 않는다
  const [restored, setRestored] = useState(
    () => new Set(Object.keys(dataFile.codebook ?? {})),
  );
  // 코드를 적용하거나 파일에서 코드북을 불러오면 입력 표를 그 코드북으로 맞춘다
  // ([변수 규칙 수정]으로 돌아왔을 때 적용한 코드가 그대로 보이도록)
  const [seenCodebook, setSeenCodebook] = useState(dataFile.codebook);
  if (dataFile.codebook && dataFile.codebook !== seenCodebook) {
    setSeenCodebook(dataFile.codebook);
    setCodeInputs(inputsFromCodebook(dataFile.codebook));
    setRestored(new Set(Object.keys(dataFile.codebook)));
    setOrdered(orderedColumns(dataFile.codebook));
  }
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const activeProfile = profiles.find((p) => p.column === active);

  const typeOf = (p: ColumnProfile): VariableType =>
    dataFile.variableTypes?.[p.column] ?? inferredType(p);

  // 입력하지 않은 값은 기본값을 쓴다. 스크리닝에서 값이 바뀌어도 지금 데이터의 값 목록을 따른다
  const rowsOf = (p: ColumnProfile) =>
    defaultRows(p).map(
      (row) =>
        codeInputs[p.column]?.[row.source] ??
        (restored.has(p.column) ? { ...row, code: "" } : row),
    );

  // 코드를 적용한 뒤에는 그때 정한 코드북을 쓴다 (지금 시트는 이미 코드로 바뀐 Analysis_Data)
  const applied = dataFile.codebook;
  const categorical = applied
    ? []
    : profiles.filter((p) => typeOf(p) === "categorical" && p.raw_values);
  const codebook: Codebook = { ...applied };
  for (const p of categorical) {
    const levels = rowsToLevels(rowsOf(p));
    if (levels.length)
      codebook[p.column] = ordered.has(p.column)
        ? levels.map((level) => ({ ...level, ordered: true }))
        : levels;
  }
  const codeErrors = categorical.flatMap((p) => checkRows(p.column, rowsOf(p)));
  const uncoded = applied
    ? profiles.flatMap((p) =>
        Object.entries(applied[p.column] ? (p.raw_values ?? {}) : {})
          .filter(
            ([value]) =>
              !applied[p.column].some((level) => String(level.code) === value),
          )
          .map(([value, count]) => `${p.column}의 '${value}' ${count}건`),
      )
    : categorical.flatMap((p) =>
        rowsOf(p)
          .filter((row) => !row.code.trim())
          .map(
            (row) =>
              `${p.column}의 '${row.source}' ${p.raw_values![row.source]}건`,
          ),
      );
  const canExport = Object.keys(codebook).length > 0 && codeErrors.length === 0;

  function setType(column: string, type: VariableType) {
    onDataFile({
      ...dataFile,
      variableTypes: { ...dataFile.variableTypes, [column]: type },
    });
  }

  function updateRow(column: string, row: CodeRow) {
    const next = {
      ...codeInputs,
      [column]: { ...codeInputs[column], [row.source]: row },
    };
    setCodeInputs(next);
    saveCodeInputs(next, ordered);
  }

  function toggleOrdered(column: string, on: boolean) {
    const next = new Set(ordered);
    if (on) next.add(column);
    else next.delete(column);
    setOrdered(next);
    saveCodeInputs(codeInputs, next);
  }

  function saveCodeInputs(inputs: CodeInputs, orderedSet: Set<string>) {
    saveWorkspace({
      codeInputs: {
        fileKey: setupKey(dataFile),
        inputs,
        ordered: [...orderedSet],
      },
    });
  }

  // Analysis_Data 시트를 만들고, 이후 규칙·스크리닝은 이 시트를 기준으로 한다
  async function applyCodes() {
    if (!canExport) {
      onNext();
      return;
    }
    setExporting(true);
    setExportError("");
    try {
      const bytes = await engine.exportAnalysis(
        dataFile.bytes,
        dataFile.info.sheet,
        codebook,
      );
      onDataFile({
        ...dataFile,
        bytes,
        info: await engine.inspect(bytes, ANALYSIS_SHEET),
        // 코드로 바뀌면 값만 보고 유형을 다시 추천하지 않도록 지금 유형을 고정한다
        variableTypes: Object.fromEntries(
          profiles.map((p) => [p.column, typeOf(p)]),
        ),
        codebook,
        rawSheet: dataFile.info.sheet,
      });
      onNext();
    } catch (e) {
      setExportError(`코드를 적용하지 못했습니다: ${errorText(e)}`);
    } finally {
      setExporting(false);
    }
  }

  async function resetCodes() {
    if (
      dataFile.editedCells &&
      !confirm(
        "코드를 다시 적용하면 스크리닝에서 고친 값이 사라집니다. 계속할까요?",
      )
    )
      return;
    setExporting(true);
    setExportError("");
    try {
      onDataFile({
        ...dataFile,
        info: await engine.inspect(dataFile.bytes, dataFile.rawSheet),
        codebook: undefined,
        rawSheet: undefined,
        editedCells: undefined,
      });
    } catch (e) {
      setExportError(`원본 시트를 열지 못했습니다: ${errorText(e)}`);
    } finally {
      setExporting(false);
    }
  }

  // 목록에서 ↑↓ 키로 변수를 옮겨 가며 본다
  function onListKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = profiles.findIndex((p) => p.column === active);
    const next =
      profiles[
        Math.min(
          profiles.length - 1,
          Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)),
        )
      ];
    setActive(next.column);
    const row = document.getElementById(rowId(next.column));
    row?.querySelector("button")?.focus();
    row?.scrollIntoView({ block: "nearest" });
  }

  return (
    <section className="card">
      <div className="section-header">
        <h2>변수 유형과 값 설정</h2>
        <div className="toolbar">
          {applied ? (
            <>
              <button
                className="button"
                disabled={exporting}
                onClick={resetCodes}
              >
                변수 규칙 수정
              </button>
              <button className="button button-primary" onClick={onNext}>
                다음: 검사 규칙 →
              </button>
            </>
          ) : (
            <button
              className="button button-primary"
              disabled={exporting || codeErrors.length > 0}
              onClick={applyCodes}
            >
              {canExport ? "코드 적용하고 다음 →" : "다음: 검사 규칙 →"}
            </button>
          )}
        </div>
      </div>
      <p className="muted">
        유형은 값을 보고 추천해 둔 것이니 틀리면 바꾸세요. 여기서 정한 유형은
        검사 규칙, 스크리닝, 내보내기에 모두 적용되고, 숫자·날짜의 허용
        범위는 다음 단계인 검사 규칙에서 정합니다. 범주형은
        원본 값마다 숫자 코드와 라벨을 정하고, 같은 코드를 입력하면 하나로
        묶입니다. 코드는 자동으로 채운 초안이니 확인하고, 오류로 보이는 값(X
        등)은 코드를 비워 두세요.
      </p>
      <details className="small">
        <summary className="muted">유형별 요약 방법</summary>
        <dl className="type-legend">
          {TYPES.map((t) => (
            <div key={t}>
              <dt>{TYPE_LABELS[t]}</dt>
              <dd className="muted">{TYPE_HELP[t]}</dd>
            </div>
          ))}
        </dl>
      </details>

      <div className="variables-layout">
        <div className="variable-nav" onKeyDown={onListKey}>
          <div className="table-wrap">
            <table className="variable-list">
              <thead>
                <tr>
                  <th>변수</th>
                  <th>유형</th>
                  <th>결측</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => {
                  const type = typeOf(p);
                  const isActive = p.column === active;
                  return (
                    <tr
                      key={p.column}
                      id={rowId(p.column)}
                      className={isActive ? "active" : ""}
                      onClick={() => setActive(p.column)}
                    >
                      <td className="file-name">
                        <button
                          className="row-button"
                          aria-current={isActive}
                          onClick={() => setActive(p.column)}
                        >
                          {p.column}
                        </button>
                      </td>
                      <td>
                        <span
                          className={`type-tag ${type !== inferredType(p) ? "changed" : ""}`}
                        >
                          {TYPE_LABELS[type]}
                        </span>
                      </td>
                      <td className="small">
                        {p.missing ? (
                          <>
                            {p.missing}{" "}
                            <span className="muted">
                              ({p.missing_percent}%)
                            </span>
                          </>
                        ) : (
                          <span className="muted">0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="variable-detail">
          {activeProfile && (
            <>
              <div className="detail-settings">
                <h3 className="detail-title">{active}</h3>
                <label className="inline">
                  유형
                  <select
                    aria-label={`${active} 유형`}
                    disabled={!!applied?.[active]}
                    value={typeOf(activeProfile)}
                    onChange={(e) =>
                      setType(active, e.target.value as VariableType)
                    }
                  >
                    {TYPES.map((t) => (
                      <option key={t} value={t} title={TYPE_HELP[t]}>
                        {TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <SuggestionNote
                  profile={activeProfile}
                  type={typeOf(activeProfile)}
                  onReset={(t) => setType(active, t)}
                />
                <label
                  className="inline small"
                  title="선택 항목처럼 비어 있어도 되는 변수는 스크리닝에서 빈 칸을 문제로 보지 않습니다"
                >
                  <input
                    type="checkbox"
                    checked={draft.form.allowMissing.includes(active)}
                    onChange={(e) =>
                      onDraft({
                        ...draft,
                        form: setAllowMissing(
                          draft.form,
                          active,
                          e.target.checked,
                        ),
                      })
                    }
                  />
                  결측 허용
                </label>
              </div>
              {applied?.[active] ? (
                <AppliedCodes levels={applied[active]} />
              ) : !applied &&
                typeOf(activeProfile) === "categorical" &&
                activeProfile.raw_values ? (
                <>
                  <label className="inline small">
                    <input
                      type="checkbox"
                      checked={ordered.has(active)}
                      onChange={(e) => toggleOrdered(active, e.target.checked)}
                    />
                    순서 있음 (학력, 병기처럼 순서가 있는 범주)
                  </label>
                  {ordered.has(active) && (
                    <p className="message message-warning small">
                      코드가 작은 값부터 순서대로입니다 (예: 학사 0 &lt; 석사 1
                      &lt; 박사 2). 자동으로 채운 코드는 가나다순이니 순서에
                      맞게 고치세요.
                    </p>
                  )}
                  <CodeTable
                    profile={activeProfile}
                    rows={rowsOf(activeProfile)}
                    onRow={(row) => updateRow(active, row)}
                  />
                </>
              ) : (
                <ValueRange
                  profile={activeProfile}
                  type={typeOf(activeProfile)}
                  form={draft.form}
                />
              )}
            </>
          )}
        </div>
      </div>
      <p className="muted small">
        엑셀의 Analysis_Data 시트에는 숫자 코드가 들어가고, 같은 폴더에서 R
        코드를 실행하면 R에서 라벨로 보입니다.
        {applied &&
          " 코드를 적용했으므로 규칙과 스크리닝은 Analysis_Data 시트를 검사합니다."}
      </p>
      {codeErrors.length > 0 && (
        <div className="message message-error">
          <ul>
            {codeErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {uncoded.length > 0 && (
        <div className="message message-warning">
          코드가 없는 값은 글자 그대로 남아 R에서 열 전체가 문자로 읽힐 수
          있습니다: {uncoded.join(", ")}
        </div>
      )}
      {exportError && <p className="message message-error">{exportError}</p>}
    </section>
  );
}

// 코드를 적용한 변수: 바꾸려면 [코드 다시 정하기]를 누른다
function AppliedCodes({ levels }: { levels: CodeLevel[] }) {
  return (
    <div className="table-wrap">
      {levels.some((level) => level.ordered) && (
        <p className="muted small">
          순서형: 코드가 작은 값부터 순서대로 (
          {[...levels]
            .sort((a, b) => a.code - b.code)
            .map((level) => level.label)
            .join(" < ")}
          )
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>코드</th>
            <th>라벨</th>
            <th>원본 값</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((level) => (
            <tr key={level.code}>
              <td>{level.code}</td>
              <td>{level.label}</td>
              <td className="mono value">{level.sources.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 범주형 변수의 원본 값마다 숫자 코드와 라벨을 정한다
function CodeTable({
  profile,
  rows,
  onRow,
}: {
  profile: ColumnProfile;
  rows: CodeRow[];
  onRow: (row: CodeRow) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>원본 값</th>
            <th>개수</th>
            <th>코드</th>
            <th>라벨</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.source}>
              <td className="mono value">
                <ValueText value={row.source} numeric={false} />
              </td>
              <td>{profile.raw_values?.[row.source]}</td>
              <td>
                <input
                  aria-label={`${row.source} 코드`}
                  size={4}
                  value={row.code}
                  onChange={(e) => onRow({ ...row, code: e.target.value })}
                />
              </td>
              <td>
                <input
                  aria-label={`${row.source} 라벨`}
                  value={row.label}
                  onChange={(e) => onRow({ ...row, label: e.target.value })}
                />
                {row.label.trim().length > 20 && (
                  <div className="muted small">
                    R 그래프에서 잘려 보일 수 있습니다.
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 추천 이유. 연구자가 유형을 바꿨으면 추천으로 되돌리는 버튼을 보여 준다
function SuggestionNote({
  profile,
  type,
  onReset,
}: {
  profile: ColumnProfile;
  type: VariableType;
  onReset: (t: VariableType) => void;
}) {
  const suggested = inferredType(profile);
  if (type === suggested) {
    return <div className="muted small">{profile.reason}</div>;
  }
  return (
    <div className="small">
      <span className="text-changed">직접 지정</span>{" "}
      <button
        className="link-button"
        onClick={() => onReset(suggested)}
        title={profile.reason}
      >
        추천({TYPE_LABELS[suggested]})으로
      </button>
    </div>
  );
}

function example(p: ColumnProfile) {
  if (p.type === "numeric" || p.type === "date") return `${p.min} ~ ${p.max}`;
  if (p.values) return Object.keys(p.values).slice(0, 5).join(", ");
  return p.examples?.join(", ") ?? "";
}

const toNum = (text: string) => (text.trim() === "" ? null : Number(text));

// 관측된 값 범위를 보여 준다. 허용 범위는 검사 규칙 단계에서 정하고, 여기서는 정해 둔 범위와 비교만 한다
function ValueRange({
  profile: p,
  type,
  form,
}: {
  profile: ColumnProfile;
  type: VariableType;
  form: RulesForm;
}) {
  if (type === "continuous" || type === "date") {
    const kind = type === "continuous" ? "numeric" : "dates";
    const range = getRange(form, kind, p.column);
    const observedType = type === "continuous" ? "numeric" : "date";
    const observed =
      p.type === observedType ? { min: p.min!, max: p.max! } : null;
    const hasRange = Boolean(range.min.trim() || range.max.trim());

    let outside = false;
    if (observed && hasRange) {
      if (type === "continuous") {
        const low = toNum(range.min);
        const high = toNum(range.max);
        outside =
          (low !== null && Number(observed.min) < low) ||
          (high !== null && Number(observed.max) > high);
      } else {
        outside =
          (!!range.min && String(observed.min) < range.min) ||
          (!!range.max && String(observed.max) > range.max);
      }
    }

    return (
      <div className="range-cell small">
        <div className={outside ? "text-error" : "muted"}>
          관측{" "}
          {observed
            ? `${observed.min} ~ ${observed.max}`
            : `(${type === "date" ? "날짜" : "숫자"} 값 없음)`}
          {outside && " · 허용 범위 밖 값 있음"}
        </div>
        <div className="muted">
          {hasRange
            ? `허용 범위 ${range.min || "…"} ~ ${range.max || "…"} (② 검사 규칙에서 바꿉니다)`
            : "허용 범위는 ② 검사 규칙에서 정합니다."}
        </div>
      </div>
    );
  }

  // 범주형: 규칙에 허용값이 있으면 그 밖의 값을 빨갛게 보여 준다 (허용값 수정은 검사 규칙 단계에서)
  const allowed = form.categorical.find(
    (r) => r.column.trim() === p.column,
  )?.allowed;
  if (type === "categorical" && p.values) {
    return (
      <div className="small">
        {Object.keys(p.values).map((v, i) => (
          <span key={v}>
            {i > 0 && ", "}
            <span
              className={
                allowed && !allowed.includes(v) ? "text-error" : "muted"
              }
              title={
                allowed && !allowed.includes(v)
                  ? "규칙의 허용값이 아님"
                  : undefined
              }
            >
              {v}
            </span>
          </span>
        ))}
        {allowed && (
          <div className="muted">규칙 허용값: {allowed.join(", ")}</div>
        )}
      </div>
    );
  }
  return <span className="muted small">{example(p)}</span>;
}
