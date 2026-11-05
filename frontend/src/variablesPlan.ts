import type {
  BinPlan,
  Codebook,
  CodingPlan,
  ColumnProfile,
  VariableStats,
  VariableType,
  CodeLevel,
} from "./types";

// 화면 입력값 그대로 보관 (숫자로 바꾸기 전). 코드 칸을 비워 두면 기본 코드(1, 2, 3…)를 쓴다
export interface BinSetting {
  cuts: string;
  rightClosed: boolean;
  newColumn: string;
  codes: Record<number, string>;
}

export type BinSettings = Record<string, BinSetting>;

// 저장하는 설정 파일 모양. Python export_variables에 그대로 넘기는 값과 같다
export interface VariablesFile {
  variables: Record<string, VariableType>;
  bins: BinPlan[];
}

export const TYPE_LABELS: Record<VariableType, string> = {
  continuous: "연속형",
  categorical: "범주형",
  date: "날짜",
  identifier: "ID",
  text: "텍스트",
};

export const TYPE_HELP: Record<VariableType, string> = {
  continuous: "평균, 중앙값, 왜도 등 · 구간 나누기",
  categorical: "값별 빈도와 비율 (코드와 라벨은 변수 설정에서)",
  date: "기간(처음~마지막)과 날짜가 아닌 값",
  identifier: "대상자 수와 여러 행에 나오는 ID",
  text: "고유값 수와 자주 나오는 값",
};

export function inferredType(profile: ColumnProfile): VariableType {
  return profile.suggested === "exclude" ? "text" : profile.suggested;
}

// 처음 선택: 값이 없는 컬럼과 자유 텍스트는 빼고 고른다
export const selectedByDefault = (profile: ColumnProfile) =>
  profile.suggested !== "exclude" && profile.suggested !== "text";

export function emptyBin(column: string): BinSetting {
  return {
    cuts: "",
    rightClosed: false,
    newColumn: `${column}_grp`,
    codes: {},
  };
}

export function parseCuts(text: string): number[] | null {
  const parts = text.split(/[,\s]+/).filter(Boolean);
  const numbers = parts.map(Number);
  return numbers.every(Number.isFinite) ? numbers : null;
}

const fmt = (n: number) => String(n);

// Python variables.bin_labels와 같은 규칙
export function binLabels(cuts: number[], rightClosed: boolean): string[] {
  const [below, between, above] = rightClosed
    ? ["이하", "초과", "초과"]
    : ["미만", "이상", "이상"];
  const tail = rightClosed ? "이하" : "미만";
  return [
    `${fmt(cuts[0])} ${below}`,
    ...cuts
      .slice(1)
      .map((b, i) => `${fmt(cuts[i])} ${between} ${fmt(b)} ${tail}`),
    `${fmt(cuts.at(-1)!)} ${above}`,
  ];
}

// 구간 번호: 이상·미만이면 v 이하인 기준값 개수, 초과·이하이면 v 미만인 기준값 개수 (pandas.cut과 같은 결과)
export function binCounts(
  values: number[],
  cuts: number[],
  rightClosed: boolean,
): number[] {
  const counts = new Array(cuts.length + 1).fill(0);
  for (const v of values) {
    counts[cuts.filter((c) => (rightClosed ? c < v : c <= v)).length]++;
  }
  return counts;
}

export const binCode = (setting: BinSetting, i: number) =>
  setting.codes[i] ?? String(i + 1);

export interface PlanCheck {
  plan: CodingPlan;
  errors: string[];
  warnings: string[];
}

export const isNumber = (text: string) =>
  text.trim() !== "" && Number.isFinite(Number(text));

export function buildPlan(
  stats: VariableStats[],
  bins: BinSettings,
  existingColumns: string[],
): PlanCheck {
  const plan: CodingPlan = { bins: [] };
  const errors: string[] = [];
  const warnings: string[] = [];
  const taken = new Set(existingColumns);

  function checkName(column: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) errors.push(`${column}: 새 컬럼 이름을 입력하세요.`);
    else if (taken.has(trimmed))
      errors.push(
        `${column}: 새 컬럼 이름 '${trimmed}'이 이미 있거나 중복됩니다.`,
      );
    taken.add(trimmed);
    return trimmed;
  }

  for (const s of stats) {
    if (s.type === "continuous") {
      const setting = bins[s.column];
      if (!setting?.cuts.trim()) continue;
      const cuts = parseCuts(setting.cuts);
      const name = checkName(s.column, setting.newColumn);
      if (!cuts) {
        errors.push(
          `${s.column}: 구간 기준값은 숫자로 입력하세요. (예: 40, 65)`,
        );
        continue;
      }
      if (cuts.some((c, i) => i > 0 && cuts[i - 1] >= c)) {
        errors.push(
          `${s.column}: 구간 기준값은 작은 값부터 겹치지 않게 입력하세요.`,
        );
        continue;
      }
      const codeTexts = cuts.concat(0).map((_, i) => binCode(setting, i));
      if (!codeTexts.every(isNumber)) {
        errors.push(`${s.column}: 구간마다 숫자 코드를 입력하세요.`);
        continue;
      }
      const codeNumbers = codeTexts.map(Number);
      if (new Set(codeNumbers).size !== codeNumbers.length) {
        errors.push(`${s.column}: 구간 코드가 중복됩니다.`);
        continue;
      }
      if (s.invalid)
        warnings.push(
          `${name}: 숫자가 아닌 값 ${s.invalid}개는 빈칸이 됩니다.`,
        );
      if (s.excluded)
        warnings.push(
          `${name}: 허용 범위 밖 값 ${s.out_of_range}개는 빈칸이 됩니다.`,
        );
      plan.bins.push({
        column: s.column,
        new_column: name,
        cuts,
        codes: codeNumbers,
        right_closed: setting.rightClosed,
      });
    }
  }

  return { plan, errors, warnings };
}

// 저장한 설정 파일을 화면 입력값으로 되돌린다
export function settingsFromFile(file: VariablesFile) {
  const bins: BinSettings = {};
  for (const b of file.bins ?? []) {
    bins[b.column] = {
      cuts: b.cuts.join(", "),
      rightClosed: b.right_closed,
      newColumn: b.new_column,
      codes: Object.fromEntries(b.codes.map((c, i) => [i, String(c)])),
    };
  }
  return { bins };
}

export function isVariablesFile(value: unknown): value is VariablesFile {
  const v = value as VariablesFile;
  return (
    !!v &&
    typeof v === "object" &&
    typeof v.variables === "object" &&
    v.variables !== null
  );
}

// 코드 값의 라벨. 코드북에 없는 값이면 undefined
export function codeLabel(
  codebook: Codebook | undefined,
  column: string,
  value: string,
) {
  return codebook?.[column]?.find((level) => String(level.code) === value)
    ?.label;
}

export interface CodeRow {
  source: string;
  code: string;
  label: string;
}

// 변수 → 원본 값 → 연구자가 입력한 줄
export type CodeInputs = Record<string, Record<string, CodeRow>>;

// 숫자형: 숫자는 값 그대로 코드로 쓰고 라벨은 비움, 숫자가 아닌 값은 코드 비움
// 문자형: 가나다순 0, 1, 2… 번호와 원본 글자 라벨 (" M"과 "M"은 같은 코드)
export function defaultRows(profile: ColumnProfile): CodeRow[] {
  const sources = Object.keys(profile.raw_values ?? {});
  if (profile.type === "numeric") {
    return sources.map((source) => ({
      source,
      code: isNumber(source) ? source.trim() : "",
      label: "",
    }));
  }
  const names = [...new Set(sources.map((source) => source.trim()))].sort(
    (a, b) => a.localeCompare(b, "ko"),
  );
  return sources.map((source) => ({
    source,
    code: String(names.indexOf(source.trim())),
    label: source.trim(),
  }));
}

export function rowsToLevels(rows: CodeRow[]): CodeLevel[] {
  const levels = new Map<number, CodeLevel>();
  for (const row of rows) {
    if (!isNumber(row.code)) continue;
    const code = Number(row.code);
    const level = levels.get(code) ?? {
      code,
      label: row.label.trim(),
      sources: [],
    };
    level.sources.push(row.source);
    levels.set(code, level);
  }
  return [...levels.values()];
}

export function checkRows(column: string, rows: CodeRow[]): string[] {
  const errors: string[] = [];
  const labels = new Map<number, string>();
  for (const row of rows) {
    if (row.code.trim() === "") continue;
    if (!isNumber(row.code)) {
      errors.push(`${column}: 코드 '${row.code}'는 숫자가 아닙니다.`);
      continue;
    }
    const code = Number(row.code);
    const label = row.label.trim();
    if (!label) errors.push(`${column}: '${row.source}'의 라벨을 입력하세요.`);
    else if (labels.has(code) && labels.get(code) !== label)
      errors.push(
        `${column}: 코드 ${code}에 라벨이 두 개입니다 (${labels.get(code)}, ${label}).`,
      );
    else labels.set(code, label);
  }
  return errors;
}
