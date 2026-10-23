import { useMemo, useState } from 'react'
import { createPyodideEngine, type EngineStatus } from './engine/engine'
import { emptyForm, type RulesForm } from './rulesForm'
import type { WorkbookInfo } from './types'
import ScreeningPage from './pages/ScreeningPage'
import RulesPage from './pages/RulesPage'
import './App.css'

export interface DataFile {
  name: string
  bytes: ArrayBuffer
  info: WorkbookInfo
  // 스크리닝 화면에서 고쳐 반영한 셀 수 (불러온 그대로면 없음)
  editedCells?: number
}

export interface RulesDraft {
  name: string
  form: RulesForm
}

// 규칙 편집 내용의 자동 저장 상태 (null: 이번에 아직 편집하지 않음)
export type AutoSave = { state: 'saved'; at: Date } | { state: 'failed' } | null

type Tab = 'screening' | 'rules'

const DRAFT_KEY = 'clinical-screening:rules-draft'

function loadDraft(): RulesDraft {
  try {
    const saved = localStorage.getItem(DRAFT_KEY)
    if (saved) return JSON.parse(saved)
  } catch {
    // 저장소를 쓸 수 없는 환경이면 빈 규칙으로 시작
  }
  return { name: '', form: emptyForm() }
}

function saveDraft(draft: RulesDraft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    return true
  } catch {
    // 개인정보 보호 모드 등 저장소를 쓸 수 없는 환경
    return false
  }
}

function App() {
  const [status, setStatus] = useState<EngineStatus>({ state: 'loading', message: '검사 엔진을 준비하는 중…' })
  const engine = useMemo(() => createPyodideEngine(setStatus), [])
  const [tab, setTab] = useState<Tab>('screening')
  const [dataFile, setDataFile] = useState<DataFile | null>(null)
  const [draft, setDraft] = useState<RulesDraft>(loadDraft)
  const [autoSave, setAutoSave] = useState<AutoSave>(null)

  // 규칙은 고칠 때마다 이 브라우저에 자동 저장되고, 스크리닝에도 바로 적용된다
  function updateDraft(next: RulesDraft) {
    setDraft(next)
    setAutoSave(saveDraft(next) ? { state: 'saved', at: new Date() } : { state: 'failed' })
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>임상 데이터 스크리닝</h1>
          <p className="muted">데이터는 이 PC의 브라우저 안에서만 검사되며 외부로 전송되지 않습니다.</p>
        </div>
        <EngineBadge status={status} />
      </header>

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'screening'} onClick={() => setTab('screening')}>
          스크리닝
        </button>
        <button role="tab" aria-selected={tab === 'rules'} onClick={() => setTab('rules')}>
          규칙 편집
        </button>
      </nav>

      {/* 탭을 옮겨도 검사 결과와 고치던 값이 사라지지 않도록 두 화면을 모두 유지하고 숨기기만 한다 */}
      <main>
        <div hidden={tab !== 'screening'}>
          <ScreeningPage
            engine={engine}
            ready={status.state === 'ready'}
            dataFile={dataFile}
            onDataFile={setDataFile}
            draft={draft}
            onDraft={updateDraft}
            onEditRules={() => setTab('rules')}
          />
        </div>
        <div hidden={tab !== 'rules'}>
          <RulesPage
            engine={engine}
            ready={status.state === 'ready'}
            dataFile={dataFile}
            onDataFile={setDataFile}
            draft={draft}
            onDraft={updateDraft}
            autoSave={autoSave}
            onStartScreening={() => setTab('screening')}
          />
        </div>
      </main>
    </div>
  )
}

function EngineBadge({ status }: { status: EngineStatus }) {
  if (status.state === 'ready') return <span className="badge badge-ok">검사 엔진 준비됨</span>
  if (status.state === 'failed') return <span className="badge badge-error" title={status.message}>검사 엔진 오류</span>
  return <span className="badge badge-loading">{status.message}</span>
}

export default App
