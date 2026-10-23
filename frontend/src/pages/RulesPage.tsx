import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DataFile, RulesDraft } from '../App'
import DataFilePicker from '../components/DataFilePicker'
import RulesFileButton from '../components/RulesFileButton'
import type { ScreeningEngine } from '../engine/engine'
import { downloadBlob, errorText } from '../files'
import {
  draftFromWorkbook,
  emptyForm,
  formErrors,
  formToRules,
  missingColumns,
  OPERATORS,
  patternFromExample,
  rulesToForm,
  type RulesForm,
} from '../rulesForm'
import type { ColumnProfile, Rules } from '../types'
import exampleRulesJson from '../../../data/study_rules.json?raw'

interface Props {
  engine: ScreeningEngine
  ready: boolean
  dataFile: DataFile | null
  onDataFile: (file: DataFile | null) => void
  draft: RulesDraft
  onDraft: (draft: RulesDraft) => void
}

const COLUMN_LIST_ID = 'rule-columns'

export default function RulesPage({ engine, ready, dataFile, onDataFile, draft, onDraft }: Props) {
  const { form } = draft
  const rules = useMemo(() => formToRules(form), [form])
  const [ruleErrors, setRuleErrors] = useState<string[]>([])

  const profiles = useMemo(
    () => new Map((dataFile?.info.columns ?? []).map((c) => [c.column, c])),
    [dataFile],
  )
  const columns = [...profiles.keys()]

  // 입력이 멈추면 Python 규칙 검증을 돌린다 (스크리닝 때와 같은 검증)
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const timer = setTimeout(() => {
      engine
        .validateRules(rules)
        .then((errors) => !cancelled && setRuleErrors(errors))
        .catch((e) => !cancelled && setRuleErrors([`규칙 검증 실패: ${errorText(e)}`]))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [engine, ready, rules])

  const errors = [...formErrors(form), ...ruleErrors]
  const missing = dataFile ? missingColumns(rules, columns) : []

  function update(change: (next: RulesForm) => void) {
    const next = structuredClone(form)
    change(next)
    onDraft({ ...draft, form: next })
  }

  function replace(name: string, next: RulesForm) {
    if (Object.keys(rules).length && !confirm('지금 편집 중인 규칙을 바꿉니다. 계속할까요?')) return
    onDraft({ name, form: next })
  }

  function save() {
    const json = JSON.stringify(rules, null, 2) + '\n'
    downloadBlob(new Blob([json], { type: 'application/json' }), `${draft.name.trim() || 'study_rules'}.json`)
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="toolbar">
          <label className="inline grow">
            규칙 이름
            <input
              value={draft.name}
              placeholder="예: 고혈압_2상_baseline"
              onChange={(e) => onDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <button className="button button-ghost" onClick={() => replace('', emptyForm())}>
            새로 만들기
          </button>
          <RulesFileButton onLoad={(loaded) => replace(loaded.name, loaded.form)} />
          <button
            className="button button-ghost"
            onClick={() => replace('study_rules', rulesToForm(JSON.parse(exampleRulesJson) as Rules))}
          >
            예시 규칙
          </button>
          <button className="button button-primary" onClick={save} disabled={errors.length > 0}>
            규칙 파일 저장
          </button>
        </div>
        <p className="muted">
          저장하면 JSON 파일로 내려받습니다. NAS 공유 폴더에 두면 다른 연구자도 [규칙 파일 불러오기]로 쓸 수 있습니다.
        </p>
      </section>

      <section className="card">
        <h2>참고할 데이터</h2>
        <p className="muted">데이터를 불러오면 컬럼 목록과 관측값을 보면서 규칙을 만들 수 있습니다. 데이터는 저장되지 않습니다.</p>
        <DataFilePicker engine={engine} ready={ready} dataFile={dataFile} onDataFile={onDataFile} />
        {dataFile && (
          <button
            className="button button-ghost"
            onClick={() => replace(draft.name, draftFromWorkbook(dataFile.info))}
          >
            이 데이터로 규칙 초안 만들기
          </button>
        )}
        <datalist id={COLUMN_LIST_ID}>
          {columns.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </section>

      {(errors.length > 0 || missing.length > 0) && (
        <div className={`message ${errors.length ? 'message-error' : 'message-warning'}`}>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
            {missing.map((c) => (
              <li key={c}>컬럼 '{c}'이 불러온 데이터에 없습니다. 이 데이터에서는 해당 검사를 건너뜁니다.</li>
            ))}
          </ul>
        </div>
      )}

      <Section
        title="숫자 범위"
        help="값이 최소~최대를 벗어나면 '허용 범위 밖'으로, 숫자가 아니면 '숫자 변환 불가'로 표시합니다. 임상적으로 가능한 범위를 입력하세요."
        onAdd={() => update((f) => void f.numeric.push({ column: '', min: '', max: '' }))}
      >
        {form.numeric.map((row, i) => (
          <div className="rule-row" key={i}>
            <ColumnInput value={row.column} onChange={(v) => update((f) => void (f.numeric[i].column = v))} />
            <input
              className="narrow"
              inputMode="decimal"
              placeholder="최소"
              value={row.min}
              onChange={(e) => update((f) => void (f.numeric[i].min = e.target.value))}
            />
            <span>~</span>
            <input
              className="narrow"
              inputMode="decimal"
              placeholder="최대"
              value={row.max}
              onChange={(e) => update((f) => void (f.numeric[i].max = e.target.value))}
            />
            <Observed profile={profiles.get(row.column)} />
            <RemoveButton onClick={() => update((f) => void f.numeric.splice(i, 1))} />
          </div>
        ))}
      </Section>

      <Section
        title="범주형 허용값"
        help="허용값 외의 값은 '허용되지 않는 값'으로, 대소문자나 Male/Yes처럼 표기만 다른 값은 '표기 차이'로 표시합니다."
        onAdd={() => update((f) => void f.categorical.push({ column: '', allowed: [] }))}
      >
        {form.categorical.map((row, i) => (
          <div className="rule-row" key={i}>
            <ColumnInput value={row.column} onChange={(v) => update((f) => void (f.categorical[i].column = v))} />
            <AllowedValues
              values={row.allowed}
              observed={profiles.get(row.column)?.values}
              onChange={(values) => update((f) => void (f.categorical[i].allowed = values))}
            />
            <RemoveButton onClick={() => update((f) => void f.categorical.splice(i, 1))} />
          </div>
        ))}
      </Section>

      <Section title="대상자 ID 형식" help="ID가 형식(정규식)에 맞지 않으면 '오류'로 표시합니다. 예시 ID를 넣으면 형식을 자동으로 만들어 줍니다.">
        <div className="rule-row">
          <ColumnInput value={form.id.column} onChange={(v) => update((f) => void (f.id.column = v))} />
          <input
            className="mono grow"
            placeholder="^SUBJ-\d{3}$"
            value={form.id.pattern}
            onChange={(e) => update((f) => void (f.id.pattern = e.target.value))}
          />
        </div>
        <PatternTester
          pattern={form.id.pattern}
          examples={profiles.get(form.id.column)?.examples}
          onPattern={(p) => update((f) => void (f.id.pattern = p))}
        />
      </Section>

      <Section title="중복 레코드" help="고른 컬럼의 값 조합이 같은 행이 두 번 이상 있으면 '오류'로 표시합니다. 보통 대상자 ID + 방문입니다.">
        <div className="chips">
          {form.duplicateKeys.map((key, i) => (
            <span className="chip on" key={key}>
              {key}
              <button aria-label={`${key} 빼기`} onClick={() => update((f) => void f.duplicateKeys.splice(i, 1))}>
                ×
              </button>
            </span>
          ))}
          <AddColumn
            exclude={form.duplicateKeys}
            onAdd={(column) => update((f) => void f.duplicateKeys.push(column))}
          />
        </div>
      </Section>

      <Section
        title="날짜"
        help="날짜로 읽을 수 없는 값은 '오류', 연구 기간 밖의 날짜는 '확인 필요'로 표시합니다. 기간은 비워 두면 형식만 검사합니다."
        onAdd={() => update((f) => void f.dates.push({ column: '', min: '', max: '' }))}
      >
        {form.dates.map((row, i) => (
          <div className="rule-row" key={i}>
            <ColumnInput value={row.column} onChange={(v) => update((f) => void (f.dates[i].column = v))} />
            <input type="date" value={row.min} onChange={(e) => update((f) => void (f.dates[i].min = e.target.value))} />
            <span>~</span>
            <input type="date" value={row.max} onChange={(e) => update((f) => void (f.dates[i].max = e.target.value))} />
            <Observed profile={profiles.get(row.column)} />
            <RemoveButton onClick={() => update((f) => void f.dates.splice(i, 1))} />
          </div>
        ))}
      </Section>

      <Section
        title="컬럼 간 조건"
        help="한 행 안에서 두 값의 관계를 검사합니다. 오른쪽에는 컬럼 이름이나 숫자를 넣을 수 있습니다. 예: SBP > DBP"
        onAdd={() => update((f) => void f.cross.push({ left: '', op: '>', right: '', detail: '' }))}
      >
        {form.cross.map((row, i) => (
          <div className="rule-row" key={i}>
            <ColumnInput value={row.left} onChange={(v) => update((f) => void (f.cross[i].left = v))} />
            <select
              className="narrow"
              value={row.op}
              onChange={(e) => update((f) => void (f.cross[i].op = e.target.value))}
            >
              {OPERATORS.map((op) => (
                <option key={op}>{op}</option>
              ))}
            </select>
            <ColumnInput
              value={row.right}
              placeholder="컬럼 또는 숫자"
              onChange={(v) => update((f) => void (f.cross[i].right = v))}
            />
            <input
              className="grow"
              placeholder="결과에 보일 설명 (선택)"
              value={row.detail}
              onChange={(e) => update((f) => void (f.cross[i].detail = e.target.value))}
            />
            <RemoveButton onClick={() => update((f) => void f.cross.splice(i, 1))} />
          </div>
        ))}
      </Section>

      <details className="card">
        <summary>규칙 JSON 미리 보기</summary>
        <pre>{JSON.stringify(rules, null, 2)}</pre>
      </details>
    </div>
  )
}

function Section({
  title,
  help,
  onAdd,
  children,
}: {
  title: string
  help: string
  onAdd?: () => void
  children: ReactNode
}) {
  return (
    <section className="card">
      <div className="section-header">
        <h2>{title}</h2>
        {onAdd && (
          <button className="button button-ghost" onClick={onAdd}>
            + 추가
          </button>
        )}
      </div>
      <p className="muted">{help}</p>
      <div className="rule-rows">{children}</div>
    </section>
  )
}

function ColumnInput({
  value,
  onChange,
  placeholder = '컬럼',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <input
      className="column-input"
      list={COLUMN_LIST_ID}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="icon-button" aria-label="삭제" title="삭제" onClick={onClick}>
      ×
    </button>
  )
}

function Observed({ profile }: { profile?: ColumnProfile }) {
  if (!profile || profile.min === undefined) return null
  return (
    <span className="muted small">
      관측 {profile.min} ~ {profile.max}
      {profile.invalid ? ` · 읽을 수 없는 값 ${profile.invalid}개` : ''}
    </span>
  )
}

function AllowedValues({
  values,
  observed,
  onChange,
}: {
  values: string[]
  observed?: Record<string, number>
  onChange: (values: string[]) => void
}) {
  const [input, setInput] = useState('')
  const suggestions = Object.entries(observed ?? {}).filter(([value]) => !values.includes(value))

  function add(text: string) {
    const items = text
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t && !values.includes(t))
    if (items.length) onChange([...values, ...items])
    setInput('')
  }

  return (
    <div className="allowed">
      <div className="chips">
        {values.map((value) => (
          <span className="chip on" key={value}>
            {value}
            <button aria-label={`${value} 빼기`} onClick={() => onChange(values.filter((v) => v !== value))}>
              ×
            </button>
          </span>
        ))}
        <input
          className="narrow"
          placeholder="값 입력 후 Enter"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(input)
            }
          }}
          onBlur={() => input && add(input)}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="chips suggestions">
          <span className="muted small">데이터의 값:</span>
          {suggestions.map(([value, count]) => (
            <button className="chip" key={value} onClick={() => onChange([...values, value])}>
              + {value} <span className="muted">{count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AddColumn({ exclude, onAdd }: { exclude: string[]; onAdd: (column: string) => void }) {
  const [value, setValue] = useState('')

  function submit() {
    const column = value.trim()
    if (column && !exclude.includes(column)) onAdd(column)
    setValue('')
  }

  return (
    <input
      className="column-input"
      list={COLUMN_LIST_ID}
      placeholder="컬럼 추가 후 Enter"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          submit()
        }
      }}
      onBlur={submit}
    />
  )
}

function PatternTester({
  pattern,
  examples,
  onPattern,
}: {
  pattern: string
  examples?: string[]
  onPattern: (pattern: string) => void
}) {
  const [sample, setSample] = useState('')

  const regex = useMemo(() => {
    try {
      return pattern ? new RegExp(pattern) : null
    } catch {
      return null
    }
  }, [pattern])

  // Python fullmatch와 같게: 문자열 전체가 맞아야 통과
  const test = (text: string) => {
    if (!regex) return null
    const match = text.trim().match(regex)
    return !!match && match[0] === text.trim()
  }
  const result = sample ? test(sample) : null

  return (
    <div className="rule-row">
      <input
        className="column-input mono"
        placeholder="ID 예시로 확인 (예: SUBJ-001)"
        value={sample}
        onChange={(e) => setSample(e.target.value)}
      />
      {result !== null && (
        <span className={result ? 'text-ok' : 'text-error'}>{result ? '형식에 맞음' : '형식에 맞지 않음'}</span>
      )}
      {sample.trim() && (
        <button className="button button-ghost" onClick={() => onPattern(patternFromExample(sample))}>
          이 예시로 형식 만들기
        </button>
      )}
      {examples && examples.length > 0 && <span className="muted small">데이터 예: {examples.slice(0, 3).join(', ')}</span>}
    </div>
  )
}
