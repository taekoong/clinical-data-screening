import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { isNumericIssue, issueLabel, SEVERITY_LABELS } from "../issueTypes";
import ValueText from "./ValueText";
import { cellAddress, columnLetter, parseCell, type CellPos } from "../cells";
import type { Issue, Severity, SheetTable } from "../types";

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 36;
const VIEW_HEIGHT = 520; // .grid-scroll 높이와 같게
const ROW_NUM_WIDTH = 56;
const OVERSCAN = 10;
const SEVERITY_RANK: Record<Severity, number> = {
  ERROR: 0,
  REVIEW: 1,
  INFO: 2,
};

interface Draft {
  cell: string;
  text: string;
}

interface Props {
  table: SheetTable;
  issues: Issue[];
  edits: Record<string, string>;
  selected: CellPos | null;
  disabled: boolean;
  onSelect: (pos: CellPos) => void;
  onEdit: (cell: string, value: string, original: string) => void;
}

export default function DataGrid({
  table,
  issues,
  edits,
  selected,
  disabled,
  onSelect,
  onEdit,
}: Props) {
  const [onlyIssueRows, setOnlyIssueRows] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const revealRef = useRef(false);

  const issuesByCell = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of issues) {
      if (issue.Excel_Row < 2) continue;
      if (!map.has(issue.Cell)) map.set(issue.Cell, []);
      map.get(issue.Cell)!.push(issue);
    }
    for (const list of map.values())
      list.sort(
        (a, b) => SEVERITY_RANK[a.Severity] - SEVERITY_RANK[b.Severity],
      );
    return map;
  }, [issues]);

  const issueCells = useMemo(
    () =>
      [...issuesByCell.entries()]
        .filter(([, list]) => list.some((i) => i.Severity !== "INFO"))
        .map(([cell]) => parseCell(cell))
        .sort((a, b) => a.row - b.row || a.col - b.col),
    [issuesByCell],
  );

  const rowIndices = useMemo(() => {
    const all = table.rows.map((_, i) => i);
    if (!onlyIssueRows) return all;
    const marked = new Set(
      [...issuesByCell.keys(), ...Object.keys(edits)].map(
        (cell) => parseCell(cell).row,
      ),
    );
    return all.filter((i) => marked.has(i));
  }, [table, onlyIssueRows, issuesByCell, edits]);

  const positionOf = useMemo(
    () => new Map(rowIndices.map((row, i) => [row, i])),
    [rowIndices],
  );

  const widths = useMemo(
    () =>
      table.columns.map((name, col) => {
        let longest = name.length;
        for (const row of table.rows)
          longest = Math.max(longest, row[col].length);
        return Math.min(240, Math.max(72, longest * 8 + 24));
      }),
    [table],
  );

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    rowIndices.length,
    Math.ceil((scrollTop + VIEW_HEIGHT) / ROW_HEIGHT) + OVERSCAN,
  );

  const address = selected ? cellAddress(selected) : "";
  const original = selected ? originalOf(address) : "";
  const current = edits[address] ?? original;
  const typing = draft !== null && draft.cell === address;
  const value = typing ? draft.text : current;
  const changed = selected !== null && (typing || address in edits);
  const selectedIssues = issuesByCell.get(address) ?? [];

  // 선택한 셀이 화면 밖이면 그 행까지 스크롤한다. 스크롤 후 그 셀이 그려지면 가로 위치까지 맞춘다.
  useEffect(() => {
    const box = scrollRef.current;
    const index = selected ? positionOf.get(selected.row) : undefined;
    if (!box || index === undefined) return;

    const top = index * ROW_HEIGHT;
    const visibleRows = box.clientHeight - HEADER_HEIGHT;
    if (top < box.scrollTop || top + ROW_HEIGHT > box.scrollTop + visibleRows) {
      box.scrollTop = Math.max(0, top - visibleRows / 3);
    }
    revealRef.current = true;
  }, [selected, positionOf]);

  useLayoutEffect(() => {
    if (!revealRef.current || !address) return;
    const box = scrollRef.current;
    const element = box?.querySelector<HTMLElement>(`[data-cell="${address}"]`);
    if (box && element) {
      const left = element.offsetLeft - ROW_NUM_WIDTH;
      const right = element.offsetLeft + element.offsetWidth;
      if (left < box.scrollLeft) box.scrollLeft = left;
      else if (right > box.scrollLeft + box.clientWidth)
        box.scrollLeft = right - box.clientWidth;
      revealRef.current = false;
    }
  });

  function originalOf(cell: string) {
    const { row, col } = parseCell(cell);
    return table.rows[row]?.[col] ?? "";
  }

  function changeDraft(next: Draft | null) {
    draftRef.current = next;
    setDraft(next);
  }

  function commit() {
    const pending = draftRef.current;
    if (!pending) return;
    changeDraft(null);
    if (!disabled) onEdit(pending.cell, pending.text, originalOf(pending.cell));
  }

  function select(pos: CellPos) {
    commit();
    onSelect(pos);
  }

  function revert() {
    changeDraft(null);
    if (selected && !disabled) onEdit(address, original, original);
  }

  function focusGrid() {
    scrollRef.current?.focus({ preventScroll: true });
  }

  function move(dRow: number, dCol: number) {
    if (!rowIndices.length) return;
    if (!selected) {
      select({ row: rowIndices[0], col: 0 });
      return;
    }
    const index = positionOf.get(selected.row) ?? 0;
    const row =
      rowIndices[Math.min(rowIndices.length - 1, Math.max(0, index + dRow))];
    const col = Math.min(
      table.columns.length - 1,
      Math.max(0, selected.col + dCol),
    );
    select({ row, col });
  }

  function jump(direction: 1 | -1) {
    if (!issueCells.length) return;
    const key = (p: CellPos) => p.row * 100000 + p.col;
    const from = selected ? key(selected) : -1;
    const next =
      direction === 1
        ? (issueCells.find((p) => key(p) > from) ?? issueCells[0])
        : ([...issueCells].reverse().find((p) => key(p) < from) ??
          issueCells.at(-1)!);
    select(next);
    focusGrid();
  }

  function focusInput(selectAll = true) {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      if (selectAll) inputRef.current?.select();
    });
  }

  function onGridKey(event: KeyboardEvent) {
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (arrows[event.key]) {
      event.preventDefault();
      move(...arrows[event.key]);
    } else if (!selected) {
      return;
    } else if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      focusInput();
    } else if (
      (event.key === "Delete" || event.key === "Backspace") &&
      !disabled
    ) {
      event.preventDefault();
      onEdit(address, "", original);
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !disabled
    ) {
      event.preventDefault();
      changeDraft({ cell: address, text: event.key });
      focusInput(false);
    }
  }

  function onInputKey(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      move(event.shiftKey ? -1 : 1, 0);
      focusGrid();
    } else if (event.key === "Escape") {
      changeDraft(null);
      focusGrid();
    }
  }

  const issueIndex = selected
    ? issueCells.findIndex(
        (p) => p.row === selected.row && p.col === selected.col,
      )
    : -1;

  return (
    <div className="grid-view">
      <div className="toolbar">
        <button
          className="button button-ghost"
          onClick={() => jump(-1)}
          disabled={!issueCells.length}
        >
          ◀ 이전 문제
        </button>
        <button
          className="button button-ghost"
          onClick={() => jump(1)}
          disabled={!issueCells.length}
        >
          다음 문제 ▶
        </button>
        <span className="muted">
          {issueIndex >= 0
            ? `문제 셀 ${issueIndex + 1} / ${issueCells.length}`
            : `문제 셀 ${issueCells.length}개`}
        </span>
        <span className="grow" />
        <label className="inline">
          <input
            type="checkbox"
            checked={onlyIssueRows}
            onChange={(e) => setOnlyIssueRows(e.target.checked)}
          />
          문제 있는 행만 보기
        </label>
      </div>

      <div className="grid-help" role="note">
        <strong>고치는 법</strong>
        <span>
          셀을 고르고 바로 입력하거나 <kbd>Enter</kbd>
        </span>
        <span>
          <kbd>Enter</kbd> 또는 [수정하기]로 확정
        </span>
        <span>
          <kbd>Esc</kbd> 입력 취소
        </span>
        <span>
          <kbd>↺</kbd> 원래 값으로
        </span>
        <span>
          <kbd>←</kbd>
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          <kbd>→</kbd> 이동
        </span>
        <span>
          <kbd>Delete</kbd> 지우기
        </span>
      </div>

      <div className="formula-bar">
        <span className="cell-name mono">{address || "—"}</span>
        <span className="column-name">
          {selected ? table.columns[selected.col] : ""}
        </span>
        <input
          ref={inputRef}
          className={`mono grow ${changed ? "edited" : ""}`}
          value={value}
          placeholder={selected ? "(빈 값)" : "표에서 셀을 선택하세요"}
          aria-label="선택한 셀 값"
          disabled={!selected || disabled}
          onChange={(e) => changeDraft({ cell: address, text: e.target.value })}
          onKeyDown={onInputKey}
          onBlur={commit}
        />
        {/* 버튼을 눌러도 입력칸 포커스가 먼저 빠지지 않도록 mousedown 기본 동작을 막는다 */}
        <button
          className="button button-primary"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            commit();
            focusGrid();
          }}
          disabled={!typing || draft.text === current || disabled}
        >
          수정하기
        </button>
        <button
          className="icon-button revert-button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={revert}
          disabled={!changed || disabled}
          aria-label="원래 값으로 되돌리기"
          title={
            changed
              ? `원래 값(${original === "" ? "빈 값" : original})으로 되돌리기`
              : "되돌릴 수정이 없습니다"
          }
        >
          ↺
        </button>
      </div>

      {changed && (
        <p className="muted small">
          원래 값:{" "}
          <span className="mono">{original === "" ? "(빈 값)" : original}</span>
        </p>
      )}

      {selected && (
        <ul className="cell-issues">
          {selectedIssues.length === 0 && (
            <li className="muted">이 셀에서 발견된 문제가 없습니다.</li>
          )}
          {selectedIssues.map((issue) => (
            <li key={issue.Issue_Type}>
              <span className={`severity severity-${issue.Severity}`}>
                {SEVERITY_LABELS[issue.Severity]}
              </span>
              <strong>{issueLabel(issue.Issue_Type)}</strong>
              <span>{issue.Description}</span>
            </li>
          ))}
        </ul>
      )}

      <div
        ref={scrollRef}
        className="grid-scroll"
        tabIndex={0}
        role="grid"
        aria-label="검사한 데이터"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onKeyDown={onGridKey}
      >
        <table className="grid">
          <colgroup>
            <col style={{ width: ROW_NUM_WIDTH }} />
            {widths.map((width, col) => (
              <col key={col} style={{ width }} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ height: HEADER_HEIGHT }}>
              <th className="row-num" />
              {table.columns.map((name, col) => (
                <th
                  key={col}
                  title={name}
                  className={selected?.col === col ? "current" : ""}
                >
                  <span className="col-letter">{columnLetter(col)}</span> {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {first > 0 && (
              <tr style={{ height: first * ROW_HEIGHT }} aria-hidden />
            )}
            {rowIndices.slice(first, last).map((row) => (
              <tr key={row} style={{ height: ROW_HEIGHT }}>
                <th
                  className={`row-num ${selected?.row === row ? "current" : ""}`}
                >
                  {row + 2}
                </th>
                {table.rows[row].map((text, col) => {
                  const cell = cellAddress({ row, col });
                  const cellIssues = issuesByCell.get(cell);
                  const shown = draft?.cell === cell ? draft.text : edits[cell];
                  const edited = shown !== undefined;
                  const isSelected =
                    selected?.row === row && selected.col === col;
                  const classes = [
                    cellIssues ? `value cell-${cellIssues[0].Severity}` : "",
                    edited ? "cell-edited" : "",
                    isSelected ? "cell-selected" : "",
                  ];
                  return (
                    <td
                      key={col}
                      data-cell={cell}
                      className={classes.join(" ")}
                      title={cellIssues
                        ?.map(
                          (i) =>
                            `${issueLabel(i.Issue_Type)}: ${i.Description}`,
                        )
                        .join("\n")}
                      onClick={() => select({ row, col })}
                      onDoubleClick={() => focusInput()}
                    >
                      {/* 문제 셀은 공백·숫자 사이 문자(17O의 O 등)를 강조해 보여 준다 */}
                      {edited ? (
                        shown
                      ) : cellIssues ? (
                        <ValueText
                          value={text}
                          numeric={cellIssues.some((i) =>
                            isNumericIssue(i.Issue_Type),
                          )}
                        />
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {last < rowIndices.length && (
              <tr
                style={{ height: (rowIndices.length - last) * ROW_HEIGHT }}
                aria-hidden
              />
            )}
          </tbody>
        </table>
      </div>

      <p className="muted small legend">
        <span className="swatch cell-ERROR" /> 오류{" "}
        <span className="swatch cell-REVIEW" /> 확인 필요{" "}
        <span className="swatch cell-INFO" /> 정보{" "}
        <span className="swatch cell-edited" /> 고친 셀
      </p>
    </div>
  );
}
