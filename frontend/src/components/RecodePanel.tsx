import { useEffect, useRef, useState } from "react";
import type { DataFile } from "../App";
import type { ScreeningEngine } from "../engine/engine";
import type { RecodePreview } from "../types";
import { downloadBlob, errorText, fileStem } from "../files";

interface Props {
  file: DataFile;
  engine: ScreeningEngine;
  disabled: boolean;
  pendingEdits: boolean;
  onBusy: (busy: boolean) => void;
  onApplied: (file: DataFile) => Promise<void>;
  column: string;
  initialSource: string;
  onClose: () => void;
}

export default function RecodePanel({ file, engine, disabled, pendingEdits, onBusy, onApplied, column, initialSource, onClose }: Props) {
  const [source, setSource] = useState(initialSource);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ file: DataFile; message: string } | null>(null);
  const [preview, setPreview] = useState<{ file: DataFile; value: RecodePreview } | null>(null);
  const [completed, setCompleted] = useState<{ file: DataFile; count: number } | null>(null);
  const latestFile = useRef<DataFile | null>(file);
  useEffect(() => {
    latestFile.current = file;
    return () => { latestFile.current = null; };
  }, [file]);

  const columns = file.info.columns.filter((profile) =>
    file.variableTypes?.[profile.column]
      ? file.variableTypes[profile.column] === "categorical"
      : profile.type === "categorical",
  );
  const validColumn = columns.some((profile) => profile.column === column);
  const currentPreview = preview?.file === file && validColumn &&
    preview.value.column === column && preview.value.source === source && preview.value.target === target
    ? preview.value : null;
  const locked = disabled || busy;

  function invalidate() {
    setPreview(null);
    setError(null);
    setCompleted(null);
  }

  async function buildPreview() {
    if (locked || !validColumn) return;
    setBusy(true);
    onBusy(true);
    invalidate();
    try {
      const value = await engine.previewRecode(file.bytes, file.info.sheet, column, source, target);
      if (latestFile.current === file) setPreview({ file, value });
    } catch (e) {
      if (latestFile.current === file) setError({ file, message: errorText(e) });
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  async function apply() {
    if (locked || !currentPreview?.edits.length) return;
    setBusy(true);
    onBusy(true);
    setError(null);
    try {
      const bytes = await engine.applyEdits(file.bytes, file.info.sheet, currentPreview.edits);
      const info = await engine.inspect(bytes, file.info.sheet, file.variableTypes);
      // 다른 탭에서 파일이나 시트를 바꾼 경우, 이전 작업 결과로 덮어쓰지 않는다.
      if (latestFile.current !== file) return;
      const next: DataFile = {
        ...file, bytes, info,
        editedCells: (file.editedCells ?? 0) + currentPreview.edits.length,
      };
      setPreview(null);
      setCompleted({ file: next, count: currentPreview.edits.length });
      await onApplied(next);
    } catch (e) {
      if (latestFile.current === file) setError({ file, message: errorText(e) });
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  function download() {
    downloadBlob(
      new Blob([file.bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `${fileStem(file.name).replace(/_corrected$/, "")}_corrected.xlsx`,
    );
  }

  return (
    <section className="bulk-edit-panel" aria-label="값 일괄 변경">
      <div className="results-header">
        <h3>{column} · 값 일괄 변경</h3>
        <button className="button button-ghost" onClick={onClose} disabled={busy}>닫기</button>
      </div>
      <p className="muted">
        기존 값과 정확히 일치하는 셀만 변경합니다. 대소문자와 공백을 구분하며,
        변경값은 텍스트로 저장합니다. 원본 파일은 유지됩니다.
        표의 행 필터와 관계없이 이 시트의 선택한 열 전체에 적용됩니다.
      </p>
      {pendingEdits && <p className="message message-warning">셀 수정 사항을 먼저 반영하거나 취소하세요.</p>}
      {!validColumn && <p className="muted">이 열을 일괄 변경하려면 위 변수 요약에서 연구자 지정 유형을 Categorical로 선택하세요.</p>}
      <fieldset className="recode-controls" disabled={locked}>
        <div className="picker">
          <label>기존 값{" "}
            <input value={source} placeholder="예: f" onChange={(e) => { setSource(e.target.value); invalidate(); }} />
          </label>
          <span aria-hidden="true">→</span>
          <label>바꿀 값{" "}
            <input value={target} placeholder="예: F" onChange={(e) => { setTarget(e.target.value); invalidate(); }} />
          </label>
          <button className="button" onClick={buildPreview}
            disabled={!validColumn || !source.trim() || !target.trim() || source === target}>
            {busy ? "처리 중…" : "변경 미리보기"}
          </button>
        </div>
      </fieldset>
      {error?.file === file && <p role="alert" className="message message-error">{error.message}</p>}
      {currentPreview && (
        <div>
          <p><strong>{currentPreview.column}: {JSON.stringify(currentPreview.source)} → {JSON.stringify(currentPreview.target)} · 변경 예정 {currentPreview.edits.length}개 셀</strong></p>
          {currentPreview.edits.length ? <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>셀</th><th>변경 전</th><th>변경 후</th></tr></thead>
                <tbody>{currentPreview.edits.slice(0, 50).map((edit) => <tr key={edit.cell}>
                  <td>{edit.cell}</td><td className="mono">{JSON.stringify(edit.expected_before)}</td><td className="mono">{JSON.stringify(edit.value)}</td>
                </tr>)}</tbody>
              </table>
            </div>
            {currentPreview.edits.length > 50 && <p className="muted">처음 50개 셀을 표시합니다. 적용 대상은 전체 {currentPreview.edits.length}개 셀입니다.</p>}
            <div className="toolbar">
              <button className="button button-primary" onClick={apply} disabled={locked}>확인한 {currentPreview.edits.length}건 적용</button>
              <button className="button button-ghost" onClick={() => setPreview(null)} disabled={locked}>취소</button>
            </div>
          </> : <p>정확히 일치하는 값이 없습니다. 대소문자와 공백을 확인하세요.</p>}
        </div>
      )}
      {completed?.file === file && <p role="status" className="message message-ok">{completed.count}개 셀을 변경하고 Change_Log에 기록했습니다.</p>}
      {!!file.editedCells && <button className="button" onClick={download} disabled={locked}>변경 이력 포함 파일 다운로드</button>}
    </section>
  );
}
