import { useState } from "react";
import type { DataFile } from "../App";
import type { ScreeningEngine } from "../engine/engine";
import { errorText } from "../files";

interface Props {
  engine: ScreeningEngine;
  ready: boolean;
  dataFile: DataFile | null;
  onDataFile: (file: DataFile | null) => void;
}

// 엑셀 파일 선택 + 시트 선택. 선택하면 컬럼 분석 결과(info)를 함께 보관한다.
export default function DataFilePicker({
  engine,
  ready,
  dataFile,
  onDataFile,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(name: string, bytes: ArrayBuffer, sheet?: string) {
    setBusy(true);
    setError("");
    try {
      onDataFile({ name, bytes, info: await engine.inspect(bytes, sheet) });
    } catch (e) {
      setError(`엑셀 파일을 읽지 못했습니다. (${errorText(e)})`);
      onDataFile(null);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    await load(file.name, await file.arrayBuffer());
  }

  return (
    <div className="picker">
      <label className={`button ${!ready || busy ? "disabled" : ""}`}>
        {dataFile ? "다른 파일 선택" : "엑셀 파일 선택"}
        <input
          type="file"
          accept=".xlsx"
          hidden
          disabled={!ready || busy}
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>

      {busy && <span className="muted">파일 분석 중…</span>}

      {dataFile && !busy && (
        <>
          <span className="file-name">{dataFile.name}</span>
          <label className="inline">
            시트
            <select
              value={dataFile.info.sheet}
              onChange={(e) =>
                load(dataFile.name, dataFile.bytes, e.target.value)
              }
            >
              {dataFile.info.sheets.map((sheet) => (
                <option key={sheet}>{sheet}</option>
              ))}
            </select>
          </label>
          <span className="muted">
            {dataFile.info.rows}행 · {dataFile.info.column_count}개 컬럼
          </span>
        </>
      )}

      {error && <p className="message message-error">{error}</p>}
    </div>
  );
}
