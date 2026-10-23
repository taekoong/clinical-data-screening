/// <reference lib="webworker" />
import type { PyodideInterface } from 'pyodide'
import validatorSource from '../../../backend/src/validator.py?raw'
import rulesSource from '../../../backend/src/rules.py?raw'
import inspectorSource from '../../../backend/src/inspector.py?raw'
import screeningSource from '../../../backend/src/screening.py?raw'
import editorSource from '../../../backend/src/editor.py?raw'
import webApiSource from './web_api.py?raw'
import type { WorkerRequest, WorkerResponse } from './protocol'

const PYTHON_MODULES: Record<string, string> = {
  validator: validatorSource,
  rules: rulesSource,
  inspector: inspectorSource,
  screening: screeningSource,
  editor: editorSource,
  web_api: webApiSource,
}

let pyodide: PyodideInterface | null = null

function post(message: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(message, transfer)
}

async function init(indexURL: string) {
  post({ type: 'progress', message: 'Python 실행 환경을 불러오는 중…' })
  const { loadPyodide } = await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)
  const instance: PyodideInterface = await loadPyodide({ indexURL })

  post({ type: 'progress', message: '데이터 분석 패키지(pandas)를 불러오는 중…' })
  const extraWheels: string[] = await (await fetch(`${indexURL}extra-wheels.json`)).json()
  await instance.loadPackage(['pandas', ...extraWheels.map((file) => indexURL + file)], {
    messageCallback: () => {},
  })

  for (const [name, source] of Object.entries(PYTHON_MODULES)) {
    instance.FS.writeFile(`/home/pyodide/${name}.py`, source)
  }
  instance.runPython('import web_api')
  pyodide = instance
}

function call(name: string, ...args: unknown[]) {
  if (!pyodide) throw new Error('Python 엔진이 아직 준비되지 않았습니다.')
  const fn = pyodide.globals.get('web_api')[name]
  return fn(...args)
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data

  try {
    switch (request.type) {
      case 'init':
        await init(request.indexURL)
        post({ type: 'ready' })
        return

      case 'inspect':
        post({ type: 'result', id: request.id, value: JSON.parse(call('api_inspect', request.data, request.sheet ?? '')) })
        return

      case 'validateRules':
        post({ type: 'result', id: request.id, value: JSON.parse(call('api_validate_rules', JSON.stringify(request.rules))) })
        return

      case 'screen': {
        const rulesJson = request.rules ? JSON.stringify(request.rules) : ''
        const payload = JSON.parse(call('api_screen', request.data, rulesJson, request.sheet ?? ''))

        if (payload.rule_errors) {
          post({ type: 'result', id: request.id, value: { ok: false, ruleErrors: payload.rule_errors } })
          return
        }

        const report: Uint8Array = call('api_last_report')
        post(
          { type: 'result', id: request.id, value: { ok: true, result: { ...payload, report } } },
          [report.buffer as ArrayBuffer],
        )
        return
      }

      case 'applyEdits': {
        const edited: Uint8Array = call(
          'api_apply_edits',
          request.data,
          request.sheet,
          JSON.stringify(request.edits),
          request.changedAt,
        )
        post({ type: 'result', id: request.id, value: edited }, [edited.buffer as ArrayBuffer])
        return
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (request.type === 'init') post({ type: 'failed', message })
    else post({ type: 'error', id: request.id, message })
  }
}
