export type Severity = 'ERROR' | 'REVIEW' | 'INFO'

export const SEVERITIES: Severity[] = ['ERROR', 'REVIEW', 'INFO']

export interface Issue {
  Sheet: string
  Excel_Row: number
  Column: string
  Cell: string
  Original_Value: string
  Issue_Type: string
  Severity: Severity
  Description: string
  Action: string
}

export interface Summary {
  total_rows: number
  total_columns: number
  issue_count: number
  by_severity: Record<Severity, number>
  rules_applied: boolean
}

// 검사한 시트 전체. rows[i]는 엑셀 i+2행 (1행은 머리글)
export interface SheetTable {
  columns: string[]
  rows: string[][]
}

export interface ScreeningResult {
  sheet: string
  summary: Summary
  warnings: string[]
  issues: Issue[]
  table: SheetTable
  report: Uint8Array
}

// 화면에서 고친 셀 하나 (issue는 Change_Log에 남길 문제 유형)
export interface CellEdit {
  cell: string
  value: string
  issue: string
}

export type ScreeningOutcome =
  | { ok: true; result: ScreeningResult }
  | { ok: false; ruleErrors: string[] }

export interface CrossCheck {
  left: string
  op: string
  right: string | number
  detail?: string
}

export interface Rules {
  numeric_columns?: Record<string, { min: number | null; max: number | null }>
  categorical_columns?: Record<string, string[]>
  id_column?: { column: string; pattern: string }
  duplicate_keys?: string[]
  date_columns?: Record<string, { min?: string; max?: string }>
  cross_checks?: CrossCheck[]
}

export type ColumnType = 'numeric' | 'date' | 'categorical' | 'text' | 'empty'

export interface ColumnProfile {
  column: string
  filled: number
  missing: number
  type: ColumnType
  min?: number | string
  max?: number | string
  invalid?: number
  values?: Record<string, number>
  unique?: number
  examples?: string[]
}

export interface WorkbookInfo {
  sheets: string[]
  sheet: string
  rows: number
  columns: ColumnProfile[]
}
