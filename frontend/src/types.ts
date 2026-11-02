export type Severity = "ERROR" | "REVIEW" | "INFO";

export const SEVERITIES: Severity[] = ["ERROR", "REVIEW", "INFO"];

export interface Issue {
  Sheet: string;
  Excel_Row: number;
  Column: string;
  Cell: string;
  Original_Value: string;
  Issue_Type: string;
  Severity: Severity;
  Description: string;
  Action: string;
}

export interface Summary {
  total_rows: number;
  total_columns: number;
  issue_count: number;
  by_severity: Record<Severity, number>;
  rules_applied: boolean;
}

// 검사한 시트 전체. rows[i]는 엑셀 i+2행 (1행은 머리글)
export interface SheetTable {
  columns: string[];
  rows: string[][];
}

export interface ScreeningResult {
  sheet: string;
  summary: Summary;
  warnings: string[];
  issues: Issue[];
  table: SheetTable;
  report: Uint8Array;
}

// 화면에서 고친 셀 하나 (issue는 Change_Log에 남길 문제 유형)
export interface CellEdit {
  cell: string;
  value: string;
  issue: string;
  as_text?: boolean;
  expected_before?: string;
}

export interface RecodePreview {
  sheet: string;
  column: string;
  source: string;
  target: string;
  edits: CellEdit[];
}

export type ScreeningOutcome =
  | { ok: true; result: ScreeningResult }
  | { ok: false; ruleErrors: string[] };

export interface CrossCheck {
  left: string;
  op: string;
  right: string | number;
  detail?: string;
}

export interface Rules {
  numeric_columns?: Record<string, { min: number | null; max: number | null }>;
  categorical_columns?: Record<string, string[]>;
  id_column?: { column: string; pattern: string };
  duplicate_keys?: string[];
  date_columns?: Record<string, { min?: string; max?: string }>;
  cross_checks?: CrossCheck[];
}

export type ColumnType = "numeric" | "date" | "categorical" | "text" | "empty";
export type VariableType =
  | "continuous"
  | "categorical"
  | "date"
  | "identifier"
  | "text";

export interface ColumnProfile {
  column: string;
  dtype: string;
  filled: number;
  missing: number;
  missing_percent: number;
  type: ColumnType;
  min?: number | string;
  max?: number | string;
  invalid?: number;
  values?: Record<string, number>;
  unique: number;
  examples?: string[];
  // 추천 유형과 이유 (inspector.suggest_type). exclude: 값이 없어 요약할 것이 없음
  suggested: VariableType | "exclude";
  reason: string;
}

export interface WorkbookInfo {
  sheets: string[];
  sheet: string;
  rows: number;
  column_count: number;
  columns: ColumnProfile[];
}

interface VariableBase {
  column: string;
  n: number;
  missing: number;
  missing_percent: number;
}

export interface ContinuousStats extends VariableBase {
  type: "continuous";
  // 규칙의 숫자 범위와 그 밖의 값. excluded면 아래 통계와 values에서 뺐다
  range_min: number | null;
  range_max: number | null;
  out_of_range: number;
  out_of_range_examples: number[];
  excluded: boolean;
  valid: number;
  invalid: number;
  invalid_examples: string[];
  values: number[];
  mean: number | null;
  std: number | null;
  min: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  max: number | null;
  skewness: number | null;
  kurtosis: number | null;
}

export interface CategoricalStats extends VariableBase {
  type: "categorical";
  levels: { value: string; count: number; percent: number }[];
}

export interface DateStats extends VariableBase {
  type: "date";
  range_min: string | null;
  range_max: string | null;
  out_of_range: number;
  out_of_range_examples: string[];
  valid: number;
  invalid: number;
  invalid_examples: string[];
  first: string | null;
  last: string | null;
}

export interface IdentifierStats extends VariableBase {
  type: "identifier";
  unique: number;
  repeated: number;
  max_rows: number;
  repeated_examples: { value: string; count: number }[];
}

export interface TextStats extends VariableBase {
  type: "text";
  unique: number;
  top: { value: string; count: number }[];
}

export type VariableStats =
  | ContinuousStats
  | CategoricalStats
  | DateStats
  | IdentifierStats
  | TextStats;

// 코딩 설정. 저장한 JSON 파일과 Python(variables.py)이 같은 모양을 쓴다
export interface BinPlan {
  column: string;
  new_column: string;
  cuts: number[];
  codes: number[];
  right_closed: boolean;
}

// kind="code": 글자 값에 숫자 코드 (M → 1), kind="label": 숫자 코드에 뜻 (1 → 상)
export interface CodePlan {
  column: string;
  new_column: string;
  kind: "code" | "label";
  mapping: Record<string, number | string>;
}

export interface CodingPlan {
  bins: BinPlan[];
  codes: CodePlan[];
}
