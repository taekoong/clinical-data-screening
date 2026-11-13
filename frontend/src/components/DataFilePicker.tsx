import { useState } from "react";
import type { DataFile } from "../App";
import type { ScreeningEngine } from "../engine/engine";
import { errorText } from "../files";

const ANALYSIS_SHEET = "Analysis_Data";

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
  const [notice, setNotice] = useState("");

  // 앱에서 받은 분석용 엑셀이면 Analysis_Data를 열고 Codebook 시트의 코드·라벨을 되살린다
  // (원본 시트를 직접 고르면 코드북 없이 연다)
  async function load(name: string, bytes: ArrayBuffer, sheet?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const found = await engine.readCodebook(bytes);
      const columns = Object.keys(found.codebook);
      if (columns.length && (sheet ?? ANALYSIS_SHEET) === ANALYSIS_SHEET) {
        onDataFile({
          name,
          bytes,
          info: await engine.inspect(bytes, ANALYSIS_SHEET),
          codebook: found.codebook,
          rawSheet: found.raw_sheet ?? undefined,
          variableTypes: Object.fromEntries(
            columns.map((column) => [column, "categorical" as const]),
          ),
        });
        setNotice(`코드북을 불러왔습니다 (${columns.length}개 변수).`);
      } else {
        onDataFile({ name, bytes, info: await engine.inspect(bytes, sheet) });
      }
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
      {notice && <p className="message message-ok">{notice}</p>}
    </div>
  );
}
