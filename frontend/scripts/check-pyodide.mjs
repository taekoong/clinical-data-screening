// Pyodide에서 Python 검사 코드를 돌려 test_all_checks.xlsx 정답표와 비교한다.
// 브라우저 엔진이 터미널(python3)과 같은 결과를 내는지, 셀 수정이 Pyodide에서도 동작하는지 확인하는 용도.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPyodide } from 'pyodide'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const indexURL = join(root, 'frontend', 'public', 'pyodide') + '/'
const extraWheels = JSON.parse(await readFile(join(indexURL, 'extra-wheels.json'), 'utf8'))

const pyodide = await loadPyodide({ indexURL })
await pyodide.loadPackage(['pandas', ...extraWheels.map((file) => indexURL + file)], { messageCallback: () => {} })

for (const module of ['validator', 'rules', 'inspector', 'screening', 'editor']) {
  pyodide.FS.writeFile(`/home/pyodide/${module}.py`, await readFile(join(root, 'backend', 'src', `${module}.py`), 'utf8'))
}

pyodide.FS.writeFile('/tmp/data.xlsx', await readFile(join(root, 'data', 'test_all_checks.xlsx')))
pyodide.globals.set('rules_json', await readFile(join(root, 'data', 'study_rules.json'), 'utf8'))

const output = pyodide.runPython(`
import json
import pandas as pd
from editor import apply_edits
from screening import run_screening

data = open('/tmp/data.xlsx', 'rb').read()
result = run_screening(data, json.loads(rules_json))
expected = pd.read_excel('/tmp/data.xlsx', sheet_name='Expected_Issues', dtype=str)
actual = set(zip(result['issues']['Cell'], result['issues']['Issue_Type']))
wanted = set(zip(expected['Cell'], expected['Expected_Issue']))

# 셀 수정 후 저장한 파일을 다시 검사하면 고친 셀의 문제가 사라져야 한다
edited = apply_edits(data, 'Raw_Data', [{'cell': 'G5', 'value': '170'}])
still_broken = 'G5' in set(run_screening(edited, json.loads(rules_json))['issues']['Cell'])

json.dumps({'issues': len(result['issues']), 'missed': sorted(wanted - actual), 'extra': sorted(actual - wanted), 'report_bytes': len(result['report']), 'edit_fixed': not still_broken})
`)

const summary = JSON.parse(output)
console.log(summary)
if (summary.missed.length || summary.extra.length || !summary.edit_fixed) process.exit(1)
console.log('Pyodide 결과가 정답표와 같습니다.')
