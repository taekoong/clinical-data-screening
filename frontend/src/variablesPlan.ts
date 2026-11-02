import type {
  BinPlan,
  CategoricalStats,
  CodePlan,
  CodingPlan,
  ColumnProfile,
  VariableStats,
  VariableType,
} from './types'

// 화면 입력값 그대로 보관 (숫자로 바꾸기 전). 코드 칸을 비워 두면 기본 코드(1, 2, 3…)를 쓴다
export interface BinSetting {
  cuts: string
  rightClosed: boolean
  newColumn: string
  codes: Record<number, string>
}

// 범주형 새 컬럼: none 만들지 않음, code 글자 → 숫자 코드 (M → 1), label 숫자 코드 → 뜻 (1 → 상)
export type CodeMode = 'none' | 'code' | 'label'

export interface CodeSetting {
  mode?: CodeMode
  newColumn?: string
  codes: Record<string, string>
  labels: Record<string, string>
  // 설정 파일에서 불러온 경우: 파일에 없는 새 값은 기본 코드를 주지 않고 빈칸으로 둔다
  unlistedBlank?: boolean
}

export type BinSettings = Record<string, BinSetting>
export type CodeSettings = Record<string, CodeSetting>

// 저장하는 설정 파일 모양. Python export_variables에 그대로 넘기는 값과 같다
export interface VariablesFile {
  variables: Record<string, VariableType>
  bins: BinPlan[]
  codes: CodePlan[]
}

export const TYPE_LABELS: Record<VariableType, string> = {
  continuous: '연속형',
  categorical: '범주형',
  date: '날짜',
  identifier: 'ID',
  text: '텍스트',
}

export const TYPE_HELP: Record<VariableType, string> = {
  continuous: '평균, 중앙값, 왜도 등 · 구간 나누기',
  categorical: '값별 빈도와 비율 · 숫자 코드 또는 값 라벨',
  date: '기간(처음~마지막)과 날짜가 아닌 값',
  identifier: '대상자 수와 여러 행에 나오는 ID',
  text: '고유값 수와 자주 나오는 값',
}

export function inferredType(profile: ColumnProfile): VariableType {
  return profile.suggested === 'exclude' ? 'text' : profile.suggested
}

// 처음 선택: 값이 없는 컬럼과 자유 텍스트는 빼고 고른다
export const selectedByDefault = (profile: ColumnProfile) =>
  profile.suggested !== 'exclude' && profile.suggested !== 'text'

export function emptyBin(column: string): BinSetting {
  return { cuts: '', rightClosed: false, newColumn: `${column}_grp`, codes: {} }
}

export function emptyCode(): CodeSetting {
  return { codes: {}, labels: {} }
}

const allNumeric = (stats: CategoricalStats) =>
  stats.levels.every((l) => l.value.trim() !== '' && Number.isFinite(Number(l.value)))

// 기본: 값이 이미 숫자(0/1, 1/2/3)면 만들지 않음 (라벨은 연구자가 정해야 하므로), 글자면 숫자 코드
export function codeMode(setting: CodeSetting | undefined, stats: CategoricalStats): CodeMode {
  return setting?.mode ?? (allNumeric(stats) ? 'none' : 'code')
}

export function newColumnName(setting: CodeSetting | undefined, column: string, mode: CodeMode) {
  return setting?.newColumn ?? `${column}_${mode === 'label' ? 'label' : 'code'}`
}

export function parseCuts(text: string): number[] | null {
  const parts = text.split(/[,\s]+/).filter(Boolean)
  const numbers = parts.map(Number)
  return numbers.every(Number.isFinite) ? numbers : null
}

const fmt = (n: number) => String(n)

// Python variables.bin_labels와 같은 규칙
export function binLabels(cuts: number[], rightClosed: boolean): string[] {
  const [below, between, above] = rightClosed ? ['이하', '초과', '초과'] : ['미만', '이상', '이상']
  const tail = rightClosed ? '이하' : '미만'
  return [
    `${fmt(cuts[0])} ${below}`,
    ...cuts.slice(1).map((b, i) => `${fmt(cuts[i])} ${between} ${fmt(b)} ${tail}`),
    `${fmt(cuts.at(-1)!)} ${above}`,
  ]
}

// 구간 번호: 이상·미만이면 v 이하인 기준값 개수, 초과·이하이면 v 미만인 기준값 개수 (pandas.cut과 같은 결과)
export function binCounts(values: number[], cuts: number[], rightClosed: boolean): number[] {
  const counts = new Array(cuts.length + 1).fill(0)
  for (const v of values) {
    counts[cuts.filter((c) => (rightClosed ? c < v : c <= v)).length]++
  }
  return counts
}

export const binCode = (setting: BinSetting, i: number) => setting.codes[i] ?? String(i + 1)

// 값이 모두 숫자(이미 0/1 등으로 코딩된 변수)면 기본으로 코드를 만들지 않는다
export function levelCode(setting: CodeSetting | undefined, stats: CategoricalStats, value: string) {
  const stored = setting?.codes[value]
  if (stored !== undefined) return stored
  if (setting?.unlistedBlank) return ''
  return String(stats.levels.findIndex((l) => l.value === value) + 1)
}

export interface PlanCheck {
  plan: CodingPlan
  errors: string[]
  warnings: string[]
}

const isNumber = (text: string) => text.trim() !== '' && Number.isFinite(Number(text))

export function buildPlan(
  stats: VariableStats[],
  bins: BinSettings,
  codes: CodeSettings,
  existingColumns: string[],
): PlanCheck {
  const plan: CodingPlan = { bins: [], codes: [] }
  const errors: string[] = []
  const warnings: string[] = []
  const taken = new Set(existingColumns)

  function checkName(column: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed) errors.push(`${column}: 새 컬럼 이름을 입력하세요.`)
    else if (taken.has(trimmed)) errors.push(`${column}: 새 컬럼 이름 '${trimmed}'이 이미 있거나 중복됩니다.`)
    taken.add(trimmed)
    return trimmed
  }

  for (const s of stats) {
    if (s.type === 'continuous') {
      const setting = bins[s.column]
      if (!setting?.cuts.trim()) continue
      const cuts = parseCuts(setting.cuts)
      const name = checkName(s.column, setting.newColumn)
      if (!cuts) {
        errors.push(`${s.column}: 구간 기준값은 숫자로 입력하세요. (예: 40, 65)`)
        continue
      }
      if (cuts.some((c, i) => i > 0 && cuts[i - 1] >= c)) {
        errors.push(`${s.column}: 구간 기준값은 작은 값부터 겹치지 않게 입력하세요.`)
        continue
      }
      const codeTexts = cuts.concat(0).map((_, i) => binCode(setting, i))
      if (!codeTexts.every(isNumber)) {
        errors.push(`${s.column}: 구간마다 숫자 코드를 입력하세요.`)
        continue
      }
      const codeNumbers = codeTexts.map(Number)
      if (new Set(codeNumbers).size !== codeNumbers.length) {
        errors.push(`${s.column}: 구간 코드가 중복됩니다.`)
        continue
      }
      if (s.invalid) warnings.push(`${name}: 숫자가 아닌 값 ${s.invalid}개는 빈칸이 됩니다.`)
      if (s.excluded) warnings.push(`${name}: 허용 범위 밖 값 ${s.out_of_range}개는 빈칸이 됩니다.`)
      plan.bins.push({ column: s.column, new_column: name, cuts, codes: codeNumbers, right_closed: setting.rightClosed })
    } else if (s.type === 'categorical') {
      const setting = codes[s.column]
      const mode = codeMode(setting, s)
      if (mode === 'none') continue
      const name = checkName(s.column, newColumnName(setting, s.column, mode))
      const mapping: Record<string, number | string> = {}
      const word = mode === 'label' ? '라벨' : '코드'
      let uncoded = 0
      for (const level of s.levels) {
        const text = mode === 'label' ? (setting?.labels[level.value] ?? '') : levelCode(setting, s, level.value)
        if (text.trim() === '') uncoded += level.count
        else if (mode === 'code' && !isNumber(text))
          errors.push(`${s.column}: '${level.value}'의 코드 '${text}'는 숫자가 아닙니다. 뜻을 적으려면 [값 라벨]을 고르세요.`)
        else mapping[level.value] = mode === 'code' ? Number(text) : text.trim()
      }
      if (!Object.keys(mapping).length) {
        errors.push(`${s.column}: ${word}을 하나 이상 입력하세요.`)
        continue
      }
      if (uncoded) warnings.push(`${name}: ${word}을 비워 둔 값 ${uncoded}개는 빈칸이 됩니다.`)
      plan.codes.push({ column: s.column, new_column: name, kind: mode, mapping })
    }
  }

  return { plan, errors, warnings }
}

// 저장한 설정 파일을 화면 입력값으로 되돌린다
export function settingsFromFile(file: VariablesFile) {
  const bins: BinSettings = {}
  const codes: CodeSettings = {}
  for (const b of file.bins ?? []) {
    bins[b.column] = {
      cuts: b.cuts.join(', '),
      rightClosed: b.right_closed,
      newColumn: b.new_column,
      codes: Object.fromEntries(b.codes.map((c, i) => [i, String(c)])),
    }
  }
  for (const c of file.codes ?? []) {
    const kind = c.kind ?? 'code'
    const values = Object.fromEntries(Object.entries(c.mapping).map(([v, code]) => [v, String(code)]))
    codes[c.column] = {
      mode: kind,
      newColumn: c.new_column,
      codes: kind === 'code' ? values : {},
      labels: kind === 'label' ? values : {},
      unlistedBlank: true,
    }
  }
  return { bins, codes }
}

export function isVariablesFile(value: unknown): value is VariablesFile {
  const v = value as VariablesFile
  return !!v && typeof v === 'object' && typeof v.variables === 'object' && v.variables !== null
}

