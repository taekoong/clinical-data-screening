import { useState, type KeyboardEvent } from "react";
import type { DataFile, RulesDraft } from "../App";
import DataFilePicker from "../components/DataFilePicker";
import type { ScreeningEngine } from "../engine/engine";
import { getRange, setRange, type RulesForm } from "../rulesForm";
import type { CodeLevel, ColumnProfile, VariableType, Codebook } from "../types";
import ValueText from "../components/ValueText";
import { analysisFileName, downloadBlob, errorText, fileStem } from "../files";
import {
  checkRows,
  defaultRows,
  inferredType,
  rowsToLevels,
  TYPE_HELP,
  TYPE_LABELS,
  type CodeInputs,
  type CodeRow,
} from "../variablesPlan";

const TYPES = Object.keys(TYPE_LABELS) as VariableType[];
const ANALYSIS_SHEET = "Analysis_Data";

interface Props {
  engine: ScreeningEngine;
  ready: boolean;
  dataFile: DataFile | null;
  onDataFile: (file: DataFile | null) => void;
  // 허용 범위는 규칙 편집 탭의 숫자 범위·날짜 기간과 같은 값이다
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
      <section className="card">
        <h2>1. 데이터 파일</h2>
        <DataFilePicker
          engine={engine}
          ready={ready}
          dataFile={dataFile}
          onDataFile={onDataFile}
        />
      </section>
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
  const [codeInputs, setCodeInputs] = useState<CodeInputs>({});
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const activeProfile = profiles.find((p) => p.column === active);

  const typeOf = (p: ColumnProfile): VariableType =>
    dataFile.variableTypes?.[p.column] ?? inferredType(p);

  // 입력하지 않은 값은 기본값을 쓴다. 스크리닝에서 값이 바뀌어도 지금 데이터의 값 목록을 따른다
  const rowsOf = (p: ColumnProfile) =>
    defaultRows(p).map((row) => codeInputs[p.column]?.[row.source] ?? row);

  // 코드를 적용한 뒤에는 그때 정한 코드북을 쓴다 (지금 시트는 이미 코드로 바뀐 Analysis_Data)
  const applied = dataFile.codebook;
  const categorical = applied
    ? []
    : profiles.filter((p) => typeOf(p) === "categorical" && p.raw_values);
  const codebook: Codebook = { ...applied };
  for (const p of categorical) {
    const levels = rowsToLevels(rowsOf(p));
    if (levels.length) codebook[p.column] = levels;
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
  const excelName = analysisFileName(dataFile.name);

  function setType(column: string, type: VariableType) {
    onDataFile({
      ...dataFile,
      variableTypes: { ...dataFile.variableTypes, [column]: type },
    });
  }

  function updateRow(column: string, row: CodeRow) {
    setCodeInputs({
      ...codeInputs,
      [column]: { ...codeInputs[column], [row.source]: row },
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
      !confirm("코드를 다시 적용하면 스크리닝에서 고친 값이 사라집니다. 계속할까요?")
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

  async function download(kind: "excel" | "r") {
    setExporting(true);
    setExportError("");
    try {
      if (kind === "excel") {
        // 적용한 뒤에는 스크리닝에서 고친 값까지 담긴 지금 파일을 내려받는다
        const bytes = applied
          ? dataFile.bytes
          : await engine.exportAnalysis(
              dataFile.bytes,
              dataFile.info.sheet,
              codebook,
            );
        downloadBlob(
          new Blob([bytes], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
          excelName,
        );
      } else {
        const script = await engine.rScript(excelName, codebook);
        downloadBlob(
          new Blob([script], { type: "text/plain;charset=utf-8" }),
          `${fileStem(dataFile.name)}_load_data.R`,
        );
      }
    } catch (e) {
      setExportError(`파일을 만들지 못했습니다: ${errorText(e)}`);
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
        <h2>2. 변수 유형과 값 설정</h2>
        <div className="toolbar">
          {applied ? (
            <>
              <button
                className="button"
                disabled={exporting}
                onClick={resetCodes}
              >
                코드 다시 정하기
              </button>
              <button className="button button-primary" onClick={onNext}>
                다음: 규칙 편집 →
              </button>
            </>
          ) : (
            <button
              className="button button-primary"
              disabled={exporting || codeErrors.length > 0}
              onClick={applyCodes}
            >
              {canExport ? "코드 적용하고 다음 →" : "다음: 규칙 편집 →"}
            </button>
          )}
        </div>
      </div>
      <p className="muted">
        유형은 값을 보고 추천해 둔 것이니 틀리면 바꾸세요. 여기서 정한 유형과
        허용 범위는 규칙 편집, 스크리닝, 요약·코딩에 모두 적용됩니다. 범주형은
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
              </div>
              {applied?.[active] ? (
                <AppliedCodes levels={applied[active]} />
              ) : !applied &&
                typeOf(activeProfile) === "categorical" &&
                activeProfile.raw_values ? (
                <CodeTable
                  profile={activeProfile}
                  rows={rowsOf(activeProfile)}
                  onRow={(row) => updateRow(active, row)}
                />
              ) : (
                <ValueRange
                  profile={activeProfile}
                  type={typeOf(activeProfile)}
                  form={draft.form}
                  onForm={(form) => onDraft({ ...draft, form })}
                />
              )}
            </>
          )}
        </div>
      </div>

      <div className="section-header">
        <h2>3. 분석용 파일 내려받기</h2>
        <div className="toolbar">
          <button
            className="button"
            disabled={!canExport || exporting}
            onClick={() => download("excel")}
          >
            분석용 엑셀
          </button>
          <button
            className="button"
            disabled={!canExport || exporting}
            onClick={() => download("r")}
          >
            R 라벨 코드
          </button>
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

// 관측된 값 범위를 보여 주고, 연구자가 허용 범위를 정한다 (규칙 편집 탭과 같은 값)
function ValueRange({
  profile: p,
  type,
  form,
  onForm,
}: {
  profile: ColumnProfile;
  type: VariableType;
  form: RulesForm;
  onForm: (form: RulesForm) => void;
}) {
  if (type === "continuous" || type === "date") {
    const kind = type === "continuous" ? "numeric" : "dates";
    const range = getRange(form, kind, p.column);
    const observedType = type === "continuous" ? "numeric" : "date";
    const observed =
      p.type === observedType ? { min: p.min!, max: p.max! } : null;

    let outside = false;
    let badInput: boolean;
    if (type === "continuous") {
      const low = toNum(range.min);
      const high = toNum(range.max);
      badInput =
        Number.isNaN(low) ||
        Number.isNaN(high) ||
        (low !== null && high !== null && low > high);
      if (observed && !badInput)
        outside =
          (low !== null && Number(observed.min) < low) ||
          (high !== null && Number(observed.max) > high);
    } else {
      badInput = !!range.min && !!range.max && range.min > range.max;
      if (observed && !badInput)
        outside =
          (!!range.min && String(observed.min) < range.min) ||
          (!!range.max && String(observed.max) > range.max);
    }
    const update = (min: string, max: string) =>
      onForm(setRange(form, kind, p.column, min, max));
    const inputType = type === "date" ? "date" : "text";
    // 스크리닝의 숫자 범위 규칙은 최소와 최대가 모두 있어야 한다 (날짜 기간은 한쪽만 있어도 된다)
    const oneSided =
      type === "continuous" && !range.min.trim() !== !range.max.trim();

    return (
      <div className="range-cell">
        <div className={`small ${outside ? "text-error" : "muted"}`}>
          관측{" "}
          {observed
            ? `${observed.min} ~ ${observed.max}`
            : `(${type === "date" ? "날짜" : "숫자"} 값 없음)`}
          {outside && " · 허용 범위 밖 값 있음"}
        </div>
        <div className="range-inputs small">
          <span className="muted">허용</span>
          <input
            type={inputType}
            inputMode="decimal"
            aria-label={`${p.column} 허용 최소`}
            aria-invalid={badInput}
            placeholder="최소"
            value={range.min}
            onChange={(e) => update(e.target.value, range.max)}
          />
          ~
          <input
            type={inputType}
            inputMode="decimal"
            aria-label={`${p.column} 허용 최대`}
            aria-invalid={badInput}
            placeholder="최대"
            value={range.max}
            onChange={(e) => update(range.min, e.target.value)}
          />
        </div>
        {badInput && (
          <div className="text-error small">
            최소가 최대보다 크거나 숫자가 아닙니다.
          </div>
        )}
        {oneSided && !badInput && (
          <div className="text-error small">
            스크리닝을 실행하려면 최소와 최대를 모두 입력하세요.
          </div>
        )}
      </div>
    );
  }

  // 범주형: 규칙에 허용값이 있으면 그 밖의 값을 빨갛게 보여 준다 (허용값 수정은 규칙 편집 탭에서)
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
