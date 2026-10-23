// Pyodide 실행 파일과 필요한 Python 패키지를 public/pyodide에 모아 둔다.
// NAS가 인터넷에 연결되어 있지 않아도 동작하도록 모든 파일을 앱 안에 포함한다.
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'node_modules', 'pyodide')
const target = join(root, 'public', 'pyodide')

const { version } = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
const lock = JSON.parse(await readFile(join(source, 'pyodide-lock.json'), 'utf8'))
const cdn = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`

const CORE_FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']

// Pyodide 기본 배포판에 없는 순수 Python 패키지 (pandas가 엑셀을 읽고 쓰는 데 필요)
const EXTRA_WHEELS = [
  {
    file: 'openpyxl-3.1.5-py2.py3-none-any.whl',
    url: 'https://files.pythonhosted.org/packages/c0/da/977ded879c29cbd04de313843e76868e6e13408a94ed6b987245dc7c8506/openpyxl-3.1.5-py2.py3-none-any.whl',
    sha256: '5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2',
  },
  {
    file: 'et_xmlfile-2.0.0-py3-none-any.whl',
    url: 'https://files.pythonhosted.org/packages/c1/8b/5fe2cc11fee489817272089c4203e679c63b570a5aaeb18d852ae3cbba6a/et_xmlfile-2.0.0-py3-none-any.whl',
    sha256: '7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa',
  },
]

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function collectPackages(names, seen = new Set()) {
  for (const name of names) {
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    collectPackages(lock.packages[key].depends, seen)
  }
  return seen
}

async function download({ file, url, sha256: expected }) {
  const path = join(target, file)
  if (existsSync(path) && sha256(await readFile(path)) === expected) return false

  const response = await fetch(url)
  if (!response.ok) throw new Error(`${file} 다운로드 실패: ${response.status}`)

  const buffer = Buffer.from(await response.arrayBuffer())
  if (sha256(buffer) !== expected) throw new Error(`${file} 해시 불일치`)

  await writeFile(path, buffer)
  return true
}

await mkdir(target, { recursive: true })

for (const file of CORE_FILES) {
  await copyFile(join(source, file), join(target, file))
}

const wheels = [
  ...[...collectPackages(['pandas'])].map((name) => {
    const pkg = lock.packages[name]
    return { file: pkg.file_name, url: cdn + pkg.file_name, sha256: pkg.sha256 }
  }),
  ...EXTRA_WHEELS,
]

let downloaded = 0
for (const wheel of wheels) {
  if (await download(wheel)) downloaded++
}

await writeFile(
  join(target, 'extra-wheels.json'),
  JSON.stringify(EXTRA_WHEELS.map((w) => w.file)),
)

console.log(`Pyodide ${version} 준비 완료 (패키지 ${wheels.length}개, 새로 받은 파일 ${downloaded}개)`)
