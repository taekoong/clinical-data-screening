import type { ColumnProfile, CrossCheck, Rules, WorkbookInfo } from './types'

// 화면에서 편집하기 쉬운 형태. 숫자·날짜는 입력 중인 문자열 그대로 보관한다.
export interface RulesForm {
  numeric: { column: string; min: string; max: string }[]
  categorical: { column: string; allowed: string[] }[]
  id: { column: string; pattern: string }
  duplicateKeys: string[]
  dates: { column: string; min: string; max: string }[]
  cross: { left: string; op: string; right: string; detail: string }[]
}

export const OPERATORS = ['>', '>=', '<', '<=', '==', '!=']

export function emptyForm(): RulesForm {
  return { numeric: [], categorical: [], id: { column: '', pattern: '' }, duplicateKeys: [], dates: [], cross: [] }
}

function toNumber(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

export function formToRules(form: RulesForm): Rules {
  const rules: Rules = {}

  const numeric = form.numeric.filter((r) => r.column.trim())
  if (numeric.length) {
    rules.numeric_columns = Object.fromEntries(
      numeric.map((r) => [r.column.trim(), { min: toNumber(r.min), max: toNumber(r.max) }]),
    )
  }

  const categorical = form.categorical.filter((r) => r.column.trim())
  if (categorical.length) {
    rules.categorical_columns = Object.fromEntries(categorical.map((r) => [r.column.trim(), r.allowed]))
  }

  if (form.id.column.trim() || form.id.pattern.trim()) {
    rules.id_column = { column: form.id.column.trim(), pattern: form.id.pattern.trim() }
  }

  if (form.duplicateKeys.length) rules.duplicate_keys = form.duplicateKeys

  const dates = form.dates.filter((r) => r.column.trim())
  if (dates.length) {
    rules.date_columns = Object.fromEntries(
      dates.map((r) => {
        const limits: { min?: string; max?: string } = {}
        if (r.min) limits.min = r.min
        if (r.max) limits.max = r.max
        return [r.column.trim(), limits]
      }),
    )
  }

  const cross = form.cross.filter((r) => r.left.trim())
  if (cross.length) {
    rules.cross_checks = cross.map((r) => {
      const number = toNumber(r.right)
      const check: CrossCheck = {
        left: r.left.trim(),
        op: r.op,
        right: number ?? r.right.trim(),
      }
      if (r.detail.trim()) check.detail = r.detail.trim()
      return check
    })
  }

  return rules
}

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value))

export function rulesToForm(rules: Rules): RulesForm {
  return {
    numeric: Object.entries(rules.numeric_columns ?? {}).map(([column, l]) => ({
      column,
      min: text(l?.min),
      max: text(l?.max),
    })),
    categorical: Object.entries(rules.categorical_columns ?? {}).map(([column, allowed]) => ({
      column,
      allowed: Array.isArray(allowed) ? allowed.map(String) : [],
    })),
    id: { column: text(rules.id_column?.column), pattern: text(rules.id_column?.pattern) },
    duplicateKeys: (rules.duplicate_keys ?? []).map(String),
    dates: Object.entries(rules.date_columns ?? {}).map(([column, l]) => ({
      column,
      min: text(l?.min),
      max: text(l?.max),
    })),
    cross: (rules.cross_checks ?? []).map((c) => ({
      left: text(c.left),
      op: c.op,
      right: text(c.right),
      detail: text(c.detail),
    })),
  }
}

// 화면 입력 단계의 오류 (같은 컬럼을 두 번 지정 등). 값 자체의 검증은 Python validate_rules가 담당한다.
export function formErrors(form: RulesForm): string[] {
  const errors: string[] = []

  const checkDuplicates = (columns: string[], label: string) => {
    const seen = new Set<string>()
    for (const column of columns.map((c) => c.trim()).filter(Boolean)) {
      if (seen.has(column)) errors.push(`${label}: '${column}' 컬럼이 두 번 지정되었습니다.`)
      seen.add(column)
    }
  }

  checkDuplicates(form.numeric.map((r) => r.column), '숫자 범위')
  checkDuplicates(form.categorical.map((r) => r.column), '범주형 허용값')
  checkDuplicates(form.dates.map((r) => r.column), '날짜')

  const unnamed = [
    ...form.numeric.map((r) => r.column),
    ...form.categorical.map((r) => r.column),
    ...form.dates.map((r) => r.column),
    ...form.cross.map((r) => r.left),
  ].filter((c) => !c.trim()).length
  if (unnamed) errors.push(`컬럼을 고르지 않은 줄이 ${unnamed}개 있습니다. 컬럼을 고르거나 줄을 삭제하세요.`)

  return errors
}

// 규칙이 불러온 데이터에 없는 컬럼을 가리키는지 확인 (없으면 그 검사는 건너뛰게 됨)
export function missingColumns(rules: Rules, columns: string[]): string[] {
  const available = new Set(columns)
  const referenced = new Set<string>([
    ...Object.keys(rules.numeric_columns ?? {}),
    ...Object.keys(rules.categorical_columns ?? {}),
    ...(rules.id_column?.column ? [rules.id_column.column] : []),
    ...(rules.duplicate_keys ?? []),
    ...Object.keys(rules.date_columns ?? {}),
    ...(rules.cross_checks ?? []).flatMap((c) => (typeof c.right === 'string' ? [c.left, c.right] : [c.left])),
  ])
  return [...referenced].filter((c) => c && !available.has(c))
}

// 'SUBJ-001' → '^SUBJ-\d{3}$'
export function patternFromExample(example: string): string {
  const escaped = example
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\d+/g, (digits) => `\\d{${digits.length}}`)
  return `^${escaped}$`
}

function looksLikeId(profile: ColumnProfile, rows: number) {
  return /id$|_id|^id|번호/i.test(profile.column) && (profile.unique ?? 0) >= rows * 0.5
}

// 데이터 분석 결과로 규칙 초안 생성. 범위·허용값은 연구자가 직접 정하도록 비워 둔다.
export function draftFromWorkbook(info: WorkbookInfo): RulesForm {
  const form = emptyForm()
  const idColumn = info.columns.find((c) => c.type === 'text' && looksLikeId(c, info.rows))
  const visitColumn = info.columns.find((c) => c.type === 'categorical' && /visit|방문/i.test(c.column))

  for (const profile of info.columns) {
    if (profile === idColumn) continue
    if (profile.type === 'numeric') form.numeric.push({ column: profile.column, min: '', max: '' })
    if (profile.type === 'categorical' && profile !== visitColumn) {
      form.categorical.push({ column: profile.column, allowed: [] })
    }
    if (profile.type === 'date') form.dates.push({ column: profile.column, min: '', max: '' })
  }

  if (idColumn) {
    form.id = { column: idColumn.column, pattern: idColumn.examples?.[0] ? patternFromExample(idColumn.examples[0]) : '' }
    form.duplicateKeys = visitColumn ? [idColumn.column, visitColumn.column] : [idColumn.column]
  }

  return form
}
