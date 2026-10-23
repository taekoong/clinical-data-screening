import { useState } from 'react'
import type { RulesDraft } from '../App'
import { errorText, fileStem, readJsonFile } from '../files'
import { rulesToForm } from '../rulesForm'
import type { Rules } from '../types'

// NAS 공유 폴더 등에 저장해 둔 규칙 JSON 파일을 불러온다
export default function RulesFileButton({ onLoad }: { onLoad: (draft: RulesDraft) => void }) {
  const [error, setError] = useState('')

  async function onFile(file: File | undefined) {
    if (!file) return
    setError('')
    try {
      const rules = (await readJsonFile(file)) as Rules
      if (!rules || typeof rules !== 'object' || Array.isArray(rules)) throw new Error('규칙 형식이 아닙니다.')
      onLoad({ name: fileStem(file.name), form: rulesToForm(rules) })
    } catch (e) {
      setError(`규칙 파일을 읽지 못했습니다. (${errorText(e)})`)
    }
  }

  return (
    <>
      <label className="button button-ghost">
        규칙 파일 불러오기
        <input
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            onFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </label>
      {error && <span className="message message-error">{error}</span>}
    </>
  )
}
