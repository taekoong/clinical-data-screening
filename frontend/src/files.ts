export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function fileStem(name: string) {
  return name.replace(/\.[^.]+$/, '')
}

export function readJsonFile(file: File): Promise<unknown> {
  return file.text().then((text) => JSON.parse(text))
}

// Python 오류는 traceback 전체가 오므로 마지막 줄(실제 오류 내용)만 보여 준다
export function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const lines = message.split('\n').map((line) => line.trim()).filter(Boolean)
  return lines.at(-1) ?? message
}
