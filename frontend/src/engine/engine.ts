import type { CellEdit, Rules, ScreeningOutcome, WorkbookInfo } from '../types'
import type { WorkerRequest, WorkerResponse } from './protocol'

// 화면은 이 인터페이스만 사용한다. 나중에 NAS 서버(API) 방식으로 바꾸면 구현만 교체하면 된다.
export interface ScreeningEngine {
  inspect(data: ArrayBuffer, sheet?: string): Promise<WorkbookInfo>
  validateRules(rules: Rules): Promise<string[]>
  screen(data: ArrayBuffer, rules: Rules | null, sheet?: string): Promise<ScreeningOutcome>
  // 셀 값을 고친 새 엑셀 파일을 돌려준다 (원본 data는 바뀌지 않음)
  applyEdits(data: ArrayBuffer, sheet: string, edits: CellEdit[]): Promise<ArrayBuffer>
}

export type EngineStatus =
  | { state: 'loading'; message: string }
  | { state: 'ready' }
  | { state: 'failed'; message: string }

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export function createPyodideEngine(onStatus: (status: EngineStatus) => void): ScreeningEngine {
  const worker = new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'module' })
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  let nextId = 1

  let markReady: () => void
  let markFailed: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve
    markFailed = reject
  })
  ready.catch(() => {})

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data
    switch (message.type) {
      case 'progress':
        onStatus({ state: 'loading', message: message.message })
        break
      case 'ready':
        onStatus({ state: 'ready' })
        markReady()
        break
      case 'failed':
        onStatus({ state: 'failed', message: message.message })
        markFailed(new Error(message.message))
        break
      case 'result':
        pending.get(message.id)?.resolve(message.value)
        pending.delete(message.id)
        break
      case 'error':
        pending.get(message.id)?.reject(new Error(message.message))
        pending.delete(message.id)
        break
    }
  }

  const indexURL = new URL('pyodide/', document.baseURI).href
  onStatus({ state: 'loading', message: '검사 엔진을 준비하는 중…' })
  worker.postMessage({ type: 'init', indexURL } satisfies WorkerRequest)

  async function request<T>(message: DistributiveOmit<Exclude<WorkerRequest, { type: 'init' }>, 'id'>): Promise<T> {
    await ready
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      worker.postMessage({ ...message, id })
    })
  }

  // 원본 파일은 화면에서 계속 쓰므로 복사본을 보낸다
  const copy = (data: ArrayBuffer) => new Uint8Array(data.slice(0))

  return {
    inspect: (data, sheet) => request({ type: 'inspect', data: copy(data), sheet }),
    validateRules: (rules) => request({ type: 'validateRules', rules }),
    screen: (data, rules, sheet) => request({ type: 'screen', data: copy(data), rules, sheet }),
    applyEdits: async (data, sheet, edits) => {
      const edited = await request<Uint8Array>({
        type: 'applyEdits',
        data: copy(data),
        sheet,
        edits,
        changedAt: localTimestamp(new Date()),
      })
      return edited.buffer.slice(edited.byteOffset, edited.byteOffset + edited.byteLength) as ArrayBuffer
    },
  }
}

// Change_Log에 남길 수정 시각 (Python 쪽은 시간대를 모르므로 PC 시각을 넘긴다)
function localTimestamp(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}
