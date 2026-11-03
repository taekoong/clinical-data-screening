import { useState, type KeyboardEvent } from "react";
import type { DataFile, RulesDraft } from "../App";
import DataFilePicker from "../components/DataFilePicker";
import type { ScreeningEngine } from "../engine/engine";
import { getRange, setRange, type RulesForm } from "../rulesForm";
import type { ColumnProfile, VariableType } from "../types";
import { inferredType, TYPE_HELP, TYPE_LABELS } from "../variablesPlan";

const TYPES = Object.keys(TYPE_LABELS) as VariableType[];

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
          key={`${dataFile.name}:${dataFile.info.sheet}`}
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
  dataFile,
  onDataFile,
  draft,
  onDraft,
  onNext,
}: Pick<Props, "onDataFile" | "draft" | "onDraft" | "onNext"> & {
  dataFile: DataFile;
}) {
  const profiles = dataFile.info.columns;
  const [active, setActive] = useState(profiles[0]?.column ?? "");
  const activeProfile = profiles.find((p) => p.column === active);

  const typeOf = (p: ColumnProfile): VariableType =>
    dataFile.variableTypes?.[p.column] ?? inferredType(p);

  function setType(column: string, type: VariableType) {
    onDataFile({
      ...dataFile,
      variableTypes: { ...dataFile.variableTypes, [column]: type },
    });
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
        <h2>2. 변수 유형과 허용 범위</h2>
        <button className="button button-primary" onClick={onNext}>
          다음: 규칙 편집 →
        </button>
      </div>
      <p className="muted">
        유형은 값을 보고 추천해 둔 것이니 틀리면 바꾸세요. 여기서 정한 유형과
        허용 범위는 규칙 편집, 스크리닝, 요약·코딩에 모두 적용됩니다.
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
              <ValueRange
                profile={activeProfile}
                type={typeOf(activeProfile)}
                form={draft.form}
                onForm={(form) => onDraft({ ...draft, form })}
              />
            </>
          )}
        </div>
      </div>
    </section>
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
