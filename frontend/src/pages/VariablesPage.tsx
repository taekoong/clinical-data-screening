import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { DataFile, RulesDraft } from "../App";
import ValueText from "../components/ValueText";
import type { ScreeningEngine } from "../engine/engine";
import {
  analysisFileName,
  downloadBlob,
  errorText,
  fileStem,
  readJsonFile,
} from "../files";
import { formToRules } from "../rulesForm";
import type {
  CategoricalStats,
  Codebook,
  ContinuousStats,
  DateStats,
  IdentifierStats,
  TextStats,
  VariableStats,
  VariableType,
} from "../types";
import {
  binCode,
  binCounts,
  binLabels,
  buildPlan,
  emptyBin,
  inferredType,
  isVariablesFile,
  parseCuts,
  selectedByDefault,
  settingsFromFile,
  TYPE_HELP,
  TYPE_LABELS,
  type BinSetting,
  type BinSettings,
  type VariablesFile,
} from "../variablesPlan";
import { saveWorkspace, savedWorkspace, summaryKey } from "../workspace";

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TYPES = Object.keys(TYPE_LABELS) as VariableType[];

interface Props {
  engine: ScreeningEngine;
  ready: boolean;
  dataFile: DataFile | null;
  onDataFile: (file: DataFile | null) => void;
  // 허용 범위는 검사 규칙 단계와 같은 값이다
  draft: RulesDraft;
  onGoToSetup: () => void;
  // 스크리닝에서 고쳤지만 아직 파일에 반영하지 않은 셀 수 (받는 파일에 들어가지 않는다)
  pendingEdits: number;
  onGoToScreening: () => void;
}

export default function VariablesPage({
  engine,
  ready,
  dataFile,
  onDataFile,
  draft,
  onGoToSetup,
  pendingEdits,
  onGoToScreening,
}: Props) {
  if (!dataFile) {
    return (
      <section className="card">
        <h2>내보내기</h2>
        <p className="muted">
          아직 불러온 데이터가 없습니다. 위의 [엑셀 파일 선택]으로 파일을
          올리세요.
        </p>
        <button className="button" onClick={onGoToSetup}>
          변수 설정으로 가기
        </button>
      </section>
    );
  }
  return (
    <div className="stack">
      {/* 다른 파일이나 시트를 고르면 선택과 코딩 설정을 새로 시작한다 */}
      <Variables
        key={`${dataFile.name}:${dataFile.info.sheet}`}
        engine={engine}
        ready={ready}
        dataFile={dataFile}
        onDataFile={onDataFile}
        draft={draft}
        onGoToSetup={onGoToSetup}
        pendingEdits={pendingEdits}
        onGoToScreening={onGoToScreening}
      />
    </div>
  );
}

// 계산한 요약을 변수마다 보관한다. 데이터가 바뀌면(셀 수정 등) 버린다
interface StatsCache {
  bytes: ArrayBuffer;
  stats: Record<string, VariableStats>;
}

const NO_STATS: Record<string, VariableStats> = {};

function Variables({
  engine,
  ready,
  dataFile,
  onDataFile,
  draft,
  onGoToSetup,
  pendingEdits,
  onGoToScreening,
}: Props & { dataFile: DataFile }) {
  const profiles = dataFile.info.columns;
  // 새로고침 전의 변수 선택·구간 설정 (같은 파일·시트일 때만)
  const [saved] = useState(() => {
    const summary = savedWorkspace().summary;
    return summary?.fileKey === summaryKey(dataFile) ? summary : undefined;
  });
  // selected: 다운로드(요약표·코딩 파일)에 넣을 변수, active: 오른쪽에 요약을 보여 줄 변수
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        saved?.selected ??
          profiles.filter(selectedByDefault).map((p) => p.column),
      ),
  );
  const [active, setActive] = useState(
    () => (profiles.find(selectedByDefault) ?? profiles[0])?.column ?? "",
  );
  const [cache, setCache] = useState<StatsCache>(() => ({
    bytes: dataFile.bytes,
    stats: {},
  }));
  const [failed, setFailed] = useState("");
  const inflight = useRef("");
  const [bins, setBins] = useState<BinSettings>(saved?.bins ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [excludeOutOfRange, setExcludeOutOfRange] = useState(
    saved?.excludeOutOfRange ?? false,
  );
  const rules = useMemo(() => formToRules(draft.form), [draft.form]);

  useEffect(() => {
    saveWorkspace({
      summary: {
        fileKey: summaryKey(dataFile),
        bins,
        selected: [...selected],
        excludeOutOfRange,
      },
    });
  }, [dataFile, bins, selected, excludeOutOfRange]);

  const typeOf = (column: string): VariableType => {
    const profile = profiles.find((p) => p.column === column)!;
    return dataFile.variableTypes?.[column] ?? inferredType(profile);
  };

  // 선택한 변수와 유형 (표의 순서대로)
  const variables = useMemo(() => {
    const result: Record<string, VariableType> = {};
    for (const p of profiles) {
      if (selected.has(p.column))
        result[p.column] =
          dataFile.variableTypes?.[p.column] ?? inferredType(p);
    }
    return result;
  }, [profiles, selected, dataFile.variableTypes]);

  // 요약은 변수마다 저장해 두고 다시 쓴다. 유형·허용 범위·제외 여부가 바뀐 변수만 새로 계산한다
  const keyOf = useCallback(
    (column: string, type: VariableType) =>
      JSON.stringify([
        column,
        type,
        rules.numeric_columns?.[column] ?? null,
        rules.date_columns?.[column] ?? null,
        excludeOutOfRange,
      ]),
    [rules, excludeOutOfRange],
  );
  const cached = cache.bytes === dataFile.bytes ? cache.stats : NO_STATS;
  const activeType = active
    ? (dataFile.variableTypes?.[active] ??
      inferredType(profiles.find((p) => p.column === active)!))
    : null;
  const activeKey = active && activeType ? keyOf(active, activeType) : "";
  const activeStats = activeKey ? cached[activeKey] : undefined;

  // 보고 있는 변수를 먼저 계산하고, 그다음 다운로드할 변수들을 미리 계산해 둔다
  const pending = useMemo(() => {
    if (activeKey && !(activeKey in cached))
      return [{ column: active, type: activeType!, key: activeKey }];
    return Object.entries(variables)
      .map(([column, type]) => ({ column, type, key: keyOf(column, type) }))
      .filter((k) => !(k.key in cached));
  }, [active, activeType, activeKey, variables, keyOf, cached]);
  const pendingKey = pending.map((k) => k.key).join("\n");
  const computing = ready && pending.length > 0 && failed !== pendingKey;
  const stats = useMemo(
    () =>
      Object.entries(variables).flatMap(([column, type]) => {
        const s = cached[keyOf(column, type)];
        return s ? [s] : [];
      }),
    [variables, keyOf, cached],
  );

  useEffect(() => {
    if (
      !ready ||
      !pendingKey ||
      failed === pendingKey ||
      inflight.current === pendingKey
    )
      return;
    // 허용 범위를 입력하는 동안에는 기다렸다가 입력이 멈추면 계산한다
    const timer = setTimeout(async () => {
      inflight.current = pendingKey;
      const bytes = dataFile.bytes;
      const subset = Object.fromEntries(pending.map((k) => [k.column, k.type]));
      try {
        const result = await engine.describe(
          bytes,
          dataFile.info.sheet,
          subset,
          rules,
          excludeOutOfRange,
        );
        const fresh = Object.fromEntries(
          pending.map((k, i) => [k.key, result[i]]),
        );
        setCache((prev) => ({
          bytes,
          stats: { ...(prev.bytes === bytes ? prev.stats : {}), ...fresh },
        }));
        setError("");
      } catch (e) {
        setFailed(pendingKey);
        setError(`요약을 계산하지 못했습니다: ${errorText(e)}`);
      } finally {
        if (inflight.current === pendingKey) inflight.current = "";
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [
    ready,
    pendingKey,
    failed,
    pending,
    engine,
    dataFile,
    rules,
    excludeOutOfRange,
  ]);

  const check = useMemo(
    () =>
      buildPlan(
        stats,
        bins,
        profiles.map((p) => p.column),
      ),
    [stats, bins, profiles],
  );

  // R 코드에 넣을 라벨: 변수 설정의 코드북 + 여기서 만든 구간
  const rCodebook = useMemo(() => {
    const merged: Codebook = { ...dataFile.codebook };
    for (const bin of check.plan.bins) {
      const labels = binLabels(bin.cuts, bin.right_closed);
      // 구간은 원래 순서가 있으므로 R에서도 순서형으로 만든다
      merged[bin.new_column] = bin.codes.map((code, i) => ({
        code,
        label: labels[i],
        sources: [],
        ordered: true,
      }));
    }
    return merged;
  }, [dataFile.codebook, check.plan.bins]);
  const stem = fileStem(dataFile.name);
  const dataFileName = dataFile.codebook
    ? analysisFileName(dataFile.name)
    : `${stem}_coded.xlsx`;
  const waiting = Object.keys(variables).length - stats.length;

  // 유형별 빠른 선택: 그 유형이 모두 선택되어 있으면 해제, 아니면 모두 선택
  function toggleType(type: VariableType) {
    const columns = profiles
      .filter((p) => typeOf(p.column) === type)
      .map((p) => p.column);
    const next = new Set(selected);
    const allOn = columns.every((c) => next.has(c));
    for (const c of columns) {
      if (allOn) next.delete(c);
      else next.add(c);
    }
    setSelected(next);
  }

  function toggle(column: string) {
    const next = new Set(selected);
    if (next.has(column)) next.delete(column);
    else next.add(column);
    setSelected(next);
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

  async function download(includeData: boolean) {
    setBusy(true);
    setError("");
    try {
      const plan = includeData ? check.plan : { bins: [] };
      const bytes = await engine.exportVariables(
        dataFile.bytes,
        dataFile.info.sheet,
        variables,
        plan,
        includeData,
        rules,
        excludeOutOfRange,
      );
      downloadBlob(
        new Blob([bytes], { type: XLSX_TYPE }),
        includeData ? dataFileName : `${stem}_summary.xlsx`,
      );
    } catch (e) {
      setError(`파일을 만들지 못했습니다: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function downloadRScript() {
    setBusy(true);
    setError("");
    try {
      const script = await engine.rScript(
        dataFileName,
        rCodebook,
        dataFile.info.sheet,
      );
      downloadBlob(
        new Blob([script], { type: "text/plain;charset=utf-8" }),
        `${stem}_load_data.R`,
      );
    } catch (e) {
      setError(`R 코드를 만들지 못했습니다: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function saveSettings() {
    const file: VariablesFile = {
      variables,
      bins: check.plan.bins,
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], {
      type: "application/json",
    });
    downloadBlob(blob, `${fileStem(dataFile.name)}_variables.json`);
  }

  async function loadSettings(file: File | undefined) {
    if (!file) return;
    setError("");
    setNotice("");
    try {
      const value = await readJsonFile(file);
      if (!isVariablesFile(value))
        throw new Error("변수 설정 파일 형식이 아닙니다.");
      const known = new Set(profiles.map((p) => p.column));
      const missing = Object.keys(value.variables).filter((c) => !known.has(c));
      const types = Object.fromEntries(
        Object.entries(value.variables).filter(([c]) => known.has(c)),
      );
      onDataFile({
        ...dataFile,
        variableTypes: { ...dataFile.variableTypes, ...types },
      });
      setSelected(new Set(Object.keys(types)));
      setBins(settingsFromFile(value).bins);
      setNotice(
        `설정을 불러왔습니다.` +
          (missing.length
            ? ` 데이터에 없는 변수는 건너뜁니다: ${missing.join(", ")}`
            : ""),
      );
    } catch (e) {
      setError(`설정 파일을 읽지 못했습니다. (${errorText(e)})`);
    }
  }

  const canExport = stats.length > 0 && waiting === 0 && !busy;

  return (
    <>
      <section className="card">
        <div className="section-header">
          <h2>1. 변수 보기</h2>
          <label className="inline">
            <input
              type="checkbox"
              checked={excludeOutOfRange}
              onChange={(e) => setExcludeOutOfRange(e.target.checked)}
            />
            허용 범위 밖 값은 계산·구간 코드에서 제외
          </label>
        </div>
        <p className="muted">
          왼쪽에서 변수를 누르면 오른쪽에 요약이 나옵니다 (↑↓ 키로도 옮길 수
          있습니다). 체크한 변수는 아래 [2. 다운로드] 파일에 들어갑니다.
        </p>
        {!!dataFile.editedCells && (
          <p className="message message-ok">
            스크리닝에서 수정한 {dataFile.editedCells}건이 반영된 데이터로
            계산합니다.
          </p>
        )}
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
        {error && <p className="message message-error">{error}</p>}

        <div className="variables-layout">
          <div className="variable-nav" onKeyDown={onListKey}>
            <div className="table-wrap">
              <table className="variable-list">
                <thead>
                  <tr>
                    <th title="다운로드에 포함">
                      <input
                        type="checkbox"
                        aria-label="전체 선택"
                        checked={selected.size === profiles.length}
                        ref={(el) => {
                          if (el)
                            el.indeterminate =
                              selected.size > 0 &&
                              selected.size < profiles.length;
                        }}
                        onChange={() =>
                          setSelected(
                            selected.size === profiles.length
                              ? new Set()
                              : new Set(profiles.map((p) => p.column)),
                          )
                        }
                      />
                    </th>
                    <th>변수</th>
                    <th>유형</th>
                    <th>결측</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => {
                    const type = typeOf(p.column);
                    const isActive = p.column === active;
                    return (
                      <tr
                        key={p.column}
                        id={rowId(p.column)}
                        className={`${isActive ? "active" : ""} ${selected.has(p.column) ? "" : "unselected"}`}
                        onClick={() => setActive(p.column)}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`${p.column} 선택`}
                            checked={selected.has(p.column)}
                            onChange={() => toggle(p.column)}
                          />
                        </td>
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
            <div className="toolbar small">
              <span className="muted">{selected.size}개 체크</span>
              {TYPES.map((t) => {
                const columns = profiles.filter((p) => typeOf(p.column) === t);
                if (!columns.length) return null;
                const on = columns.filter((p) => selected.has(p.column)).length;
                return (
                  <button
                    key={t}
                    className={`chip ${on === columns.length ? "on" : ""}`}
                    title={`${TYPE_LABELS[t]} 변수 모두 ${on === columns.length ? "해제" : "체크"}`}
                    onClick={() => toggleType(t)}
                  >
                    {TYPE_LABELS[t]} {on}/{columns.length}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="variable-detail">
            {activeType && (
              <>
                <div className="detail-settings">
                  <h3 className="detail-title">{active}</h3>
                  <span className="type-tag">{TYPE_LABELS[activeType]}</span>
                  <button className="link-button small" onClick={onGoToSetup}>
                    유형 바꾸기 (① 변수 설정)
                  </button>
                  <span className="grow" />
                  <label className="inline small">
                    <input
                      type="checkbox"
                      checked={selected.has(active)}
                      onChange={() => toggle(active)}
                    />
                    다운로드에 포함
                  </label>
                </div>
                {activeStats ? (
                  <StatsCard
                    s={activeStats}
                    bins={bins}
                    onBins={setBins}
                    onGoToSetup={onGoToSetup}
                  />
                ) : (
                  <p className="muted">
                    {ready ? "요약 계산 중…" : "계산 엔진을 준비하는 중…"}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>2. 다운로드</h2>
        {pendingEdits > 0 && (
          <div className="message message-warning">
            스크리닝에서 고친 셀 {pendingEdits}개가 아직 반영되지 않아 받는
            파일에 들어가지 않습니다.{" "}
            <button className="link-button" onClick={onGoToScreening}>
              스크리닝으로 가서 반영하기
            </button>
          </div>
        )}
        <p className="muted">
          체크한 {selected.size}개 변수가 들어갑니다
          {waiting > 0 && computing ? ` (${waiting}개 계산 중…)` : ""}. 결측과
          숫자가 아닌 값은 계산에서 빠집니다.
        </p>

        {/* 최종 결과물 두 개를 위에 묶고, 받을 파일 이름과 내용을 함께 보여 준다 */}
        <h3 className="download-title">
          최종 결과물{" "}
          <span className="muted small">
            두 파일을 같은 폴더에 두고 R에서 실행하세요. 엑셀 이름을 바꾸거나
            옮기면 R 코드가 파일을 찾지 못합니다.
          </span>
        </h3>
        <div className="download-cards">
          <div className="download-card">
            <strong>분석용 데이터 (엑셀)</strong>
            <span className="muted small">
              {dataFile.codebook
                ? "원본 시트 + Analysis_Data(구간 열 포함) + Codebook + 요약 시트"
                : `${dataFile.info.sheet} 시트에 구간 열 추가 + 요약 시트 (구간이 있으면 Codebook도)`}
              {dataFile.editedCells
                ? ` + Change_Log(스크리닝에서 고친 ${dataFile.editedCells}건의 수정 기록)`
                : ""}
            </span>
            <span className="mono small">{dataFileName}</span>
            <button
              className="button button-primary"
              onClick={() => download(true)}
              disabled={!canExport || check.errors.length > 0}
            >
              ⬇ 분석용 데이터 받기
            </button>
          </div>
          <div className="download-card">
            <strong>R 라벨 코드</strong>
            <span className="muted small">
              {Object.keys(rCodebook).length
                ? "자료 기반으로 라벨/구간 정의 부분을 R언어로 작성한 코드입니다."
                : "라벨과 구간 설정이 없으면 만들지 않습니다."}
            </span>
            <span className="mono small">{stem}_load_data.R</span>
            <button
              className="button button-primary"
              onClick={downloadRScript}
              disabled={
                !canExport ||
                check.errors.length > 0 ||
                Object.keys(rCodebook).length === 0
              }
            >
              ⬇ R 코드 받기
            </button>
          </div>
        </div>

        <div className="picker">
          <span className="muted">요약표만 필요할 때</span>
          <button
            className="button"
            onClick={() => download(false)}
            disabled={!canExport}
          >
            요약표만 받기
          </button>
          <span className="muted small">
            데이터 없이 기술통계·빈도표만 · {stem}_summary.xlsx
          </span>
        </div>

        <details className="small">
          <summary className="muted">변수 유형·구간 설정 저장/불러오기</summary>
          <div className="picker settings-row">
            <button
              className="button button-ghost"
              onClick={saveSettings}
              disabled={!canExport || check.errors.length > 0}
            >
              설정 저장
            </button>
            <label className="button button-ghost">
              설정 불러오기
              <input
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  loadSettings(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <span className="muted">
              같은 양식의 다른 파일에 변수 유형과 구간 기준값을 다시 쓸 때
              사용합니다 ({stem}_variables.json). 범주 코드·라벨은 엑셀의
              Codebook 시트에 들어 있고 여기서는 저장하지 않습니다.
            </span>
          </div>
        </details>

        {notice && <p className="message message-ok">{notice}</p>}
        {check.errors.length > 0 && (
          <div className="message message-error">
            <strong>코딩 설정을 확인하세요.</strong>
            <ul>
              {check.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {check.warnings.length > 0 && (
          <div className="message message-warning">
            <ul>
              {check.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </>
  );
}

const rowId = (column: string) => `variable-row-${encodeURIComponent(column)}`;

function StatsCard({
  s,
  bins,
  onBins,
  onGoToSetup,
}: {
  s: VariableStats;
  bins: BinSettings;
  onBins: (bins: BinSettings) => void;
  onGoToSetup: () => void;
}) {
  switch (s.type) {
    case "continuous":
      return (
        <ContinuousCard
          stats={s}
          setting={bins[s.column] ?? emptyBin(s.column)}
          onChange={(next) => onBins({ ...bins, [s.column]: next })}
        />
      );
    case "categorical":
      return <CategoricalCard stats={s} onGoToSetup={onGoToSetup} />;
    case "date":
      return <DateCard stats={s} />;
    case "identifier":
      return <IdentifierCard stats={s} />;
    case "text":
      return <TextCard stats={s} />;
  }
}

const num = (n: number | null) =>
  n === null ? "–" : n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
const pct = (count: number, total: number) =>
  total ? `${((count / total) * 100).toFixed(1)}%` : "–";

function MissingText({ s }: { s: VariableStats }) {
  return (
    <>
      결측 {s.missing}
      <span className="muted"> ({s.missing_percent}%)</span>
    </>
  );
}

function ContinuousCard({
  stats: s,
  setting,
  onChange,
}: {
  stats: ContinuousStats;
  setting: BinSetting;
  onChange: (s: BinSetting) => void;
}) {
  const cuts = parseCuts(setting.cuts);
  const validCuts =
    cuts && cuts.length > 0 && cuts.every((c, i) => i === 0 || cuts[i - 1] < c)
      ? cuts
      : null;
  const counts = validCuts
    ? binCounts(s.values, validCuts, setting.rightClosed)
    : [];
  const labels = validCuts ? binLabels(validCuts, setting.rightClosed) : [];

  return (
    <article className="variable-card">
      <CardHeader s={s}>
        {" "}
        · 계산 {s.valid}
        {s.invalid > 0 && (
          <span className="text-error">
            {" "}
            · 숫자 아님 {s.invalid} (
            <Examples values={s.invalid_examples} numeric />)
          </span>
        )}
      </CardHeader>
      <RangeNote
        min={s.range_min}
        max={s.range_max}
        count={s.out_of_range}
        examples={s.out_of_range_examples.map(String)}
        after={
          s.out_of_range
            ? s.excluded
              ? "아래 통계와 구간 코드에서 뺐습니다."
              : "아래 통계에 포함되어 있습니다."
            : ""
        }
      />

      <dl className="stat-list">
        <Item
          label="평균 ± 표준편차"
          value={`${num(s.mean)} ± ${num(s.std)}`}
        />
        <Item
          label="중앙값 [Q1–Q3]"
          value={`${num(s.median)} [${num(s.q1)}–${num(s.q3)}]`}
        />
        <Item label="최소 ~ 최대" value={`${num(s.min)} ~ ${num(s.max)}`} />
        <Item
          label="왜도"
          value={num(s.skewness)}
          hint={skewHint(s.skewness)}
        />
        <Item label="첨도" value={num(s.kurtosis)} />
      </dl>

      <div className="coding">
        <div className="picker">
          <label className="inline">
            구간 기준값
            <input
              className="column-input"
              placeholder="예: 40, 65"
              value={setting.cuts}
              onChange={(e) => onChange({ ...setting, cuts: e.target.value })}
            />
          </label>
          <div
            className="segmented small"
            role="radiogroup"
            aria-label="경계값 포함"
          >
            {[false, true].map((right) => (
              <button
                key={String(right)}
                role="radio"
                aria-checked={setting.rightClosed === right}
                aria-selected={setting.rightClosed === right}
                onClick={() => onChange({ ...setting, rightClosed: right })}
              >
                {right ? "초과 ~ 이하" : "이상 ~ 미만"}
              </button>
            ))}
          </div>
          {setting.cuts.trim() && (
            <label className="inline">
              새 컬럼
              <input
                className="narrow mono"
                value={setting.newColumn}
                onChange={(e) =>
                  onChange({ ...setting, newColumn: e.target.value })
                }
              />
            </label>
          )}
        </div>
        {!setting.cuts.trim() && (
          <p className="muted small">
            기준값을 넣으면 구간별 코드 컬럼을 만듭니다. 비워 두면 요약만
            합니다.
          </p>
        )}

        {validCuts && (
          <table className="compact">
            <thead>
              <tr>
                <th>코드</th>
                <th>구간</th>
                <th>개수</th>
                <th>비율</th>
              </tr>
            </thead>
            <tbody>
              {labels.map((label, i) => (
                <tr key={i}>
                  <td>
                    <CodeInput
                      value={binCode(setting, i)}
                      onChange={(code) =>
                        onChange({
                          ...setting,
                          codes: { ...setting.codes, [i]: code },
                        })
                      }
                    />
                  </td>
                  <td>{label}</td>
                  <td>{counts[i]}</td>
                  <td>{pct(counts[i], s.valid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </article>
  );
}

function skewHint(skew: number | null) {
  if (skew === null) return "값이 3개 이상 필요합니다";
  if (Math.abs(skew) < 0.5) return "거의 대칭";
  return skew > 0
    ? "오른쪽 꼬리가 김 (큰 값 쪽으로 치우침)"
    : "왼쪽 꼬리가 김 (작은 값 쪽으로 치우침)";
}

function CategoricalCard({
  stats: s,
  onGoToSetup,
}: {
  stats: CategoricalStats;
  onGoToSetup: () => void;
}) {
  const valid = s.n - s.missing;
  const labeled = s.levels.some((level) => "label" in level);

  return (
    <article className="variable-card">
      <CardHeader s={s}> · 값 {s.levels.length}종류</CardHeader>

      {!labeled && (
        <p className="muted small">
          숫자 코드와 라벨은{" "}
          <button className="link-button" onClick={onGoToSetup}>
            변수 설정
          </button>
          에서 정합니다.
        </p>
      )}

      <table className="compact">
        <thead>
          <tr>
            <th>{labeled ? "코드" : "값"}</th>
            {labeled && <th>라벨</th>}
            <th>개수</th>
            <th>비율</th>
          </tr>
        </thead>
        <tbody>
          {s.levels.map((level) => (
            <tr key={level.value}>
              <td className="mono value">
                <ValueText value={level.value} numeric={false} />
              </td>
              {labeled && (
                <td>
                  {level.label ?? (
                    <span className="text-error">코드북에 없음</span>
                  )}
                </td>
              )}
              <td>{level.count}</td>
              <td>{pct(level.count, valid)}</td>
            </tr>
          ))}
          <tr className="muted">
            <td>(결측)</td>
            {labeled && <td />}
            <td>{s.missing}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </article>
  );
}

function CardHeader({
  s,
  children,
}: {
  s: VariableStats;
  children?: ReactNode;
}) {
  return (
    <header>
      <h3>{s.column}</h3>
      <span className="type-tag">{TYPE_LABELS[s.type]}</span>
      <span className="muted small">
        전체 {s.n} · <MissingText s={s} />
        {children}
      </span>
    </header>
  );
}

function Examples({
  values,
  numeric = false,
}: {
  values: string[];
  numeric?: boolean;
}) {
  return (
    <>
      {values.map((v, i) => (
        <span key={v} className="mono value">
          {i > 0 && ", "}
          <ValueText value={v} numeric={numeric} />
        </span>
      ))}
    </>
  );
}

function Counts({
  items,
  unit,
}: {
  items: { value: string; count: number }[];
  unit: string;
}) {
  return (
    <>
      {items.map((t, i) => (
        <span key={t.value}>
          {i > 0 && ", "}
          <span className="mono value">
            <ValueText value={t.value} numeric={false} />
          </span>{" "}
          <span className="muted">
            ({t.count}
            {unit})
          </span>
        </span>
      ))}
    </>
  );
}

function RangeNote({
  min,
  max,
  count,
  examples,
  after,
}: {
  min: number | string | null;
  max: number | string | null;
  count: number;
  examples: string[];
  after: string;
}) {
  if (min === null && max === null) return null;
  return (
    <p className={`small ${count ? "text-error" : "muted"}`}>
      허용 범위 {min ?? ""} ~ {max ?? ""} ·{" "}
      {count ? (
        <>
          범위 밖 {count}개 (<Examples values={examples} />
          {count > examples.length && " …"}) {after}
        </>
      ) : (
        "범위 밖 값 없음"
      )}
    </p>
  );
}

function DateCard({ stats: s }: { stats: DateStats }) {
  return (
    <article className="variable-card">
      <CardHeader s={s} />
      <RangeNote
        min={s.range_min}
        max={s.range_max}
        count={s.out_of_range}
        examples={s.out_of_range_examples}
        after=""
      />
      <dl className="stat-list">
        <Item
          label="처음 ~ 마지막"
          value={s.first ? `${s.first} ~ ${s.last}` : "–"}
        />
        <Item label="날짜로 읽힌 값" value={`${s.valid}개`} />
      </dl>
      {s.invalid > 0 && (
        <p className="text-error small">
          날짜가 아닌 값 {s.invalid}개: <Examples values={s.invalid_examples} />
        </p>
      )}
    </article>
  );
}

function IdentifierCard({ stats: s }: { stats: IdentifierStats }) {
  return (
    <article className="variable-card">
      <CardHeader s={s} />
      <dl className="stat-list">
        <Item label="고유 ID 수" value={`${s.unique}개`} />
        <Item
          label="여러 행에 나오는 ID"
          value={`${s.repeated}개`}
          hint={s.repeated ? `최대 ${s.max_rows}행` : undefined}
        />
      </dl>
      {s.repeated > 0 && (
        <p className="muted small">
          예: <Counts items={s.repeated_examples} unit="행" /> — 반복
          측정(방문별 기록)이면 정상이고, 아니면 중복 입력일 수 있습니다.
        </p>
      )}
    </article>
  );
}

function TextCard({ stats: s }: { stats: TextStats }) {
  return (
    <article className="variable-card">
      <CardHeader s={s}> · 고유값 {s.unique}개</CardHeader>
      {s.top.length > 0 && (
        <p className="small">
          <span className="muted">자주 나오는 값: </span>
          <Counts items={s.top} unit="개" />
        </p>
      )}
    </article>
  );
}

function CodeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      className="code-input mono"
      inputMode="decimal"
      aria-label="코드"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Item({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value}
        {hint && <span className="muted small"> {hint}</span>}
      </dd>
    </div>
  );
}
