# 브라우저(Pyodide)에서 호출하는 진입점. 검사 로직은 프로젝트 backend/src/의 Python 코드를 그대로 사용한다.
import json

from pyodide.ffi import to_js

from editor import apply_edits
from inspector import inspect_workbook
from rules import validate_rules
from screening import RulesError, run_screening

_last_report = None


def api_inspect(data, sheet, variable_types_json="{}"):
    variable_types = json.loads(variable_types_json)

    result = inspect_workbook(
        bytes(data.to_py()),
        sheet or None,
        variable_types,
    )

    return json.dumps(result, ensure_ascii=False)

def api_validate_rules(rules_json):
    return json.dumps(validate_rules(json.loads(rules_json)), ensure_ascii=False)


def api_screen(data, rules_json, sheet):
    global _last_report
    rules = json.loads(rules_json) if rules_json else None

    try:
        result = run_screening(bytes(data.to_py()), rules, sheet or None)
    except RulesError as e:
        _last_report = None
        return json.dumps({"rule_errors": e.errors}, ensure_ascii=False)

    _last_report = result["report"]
    return json.dumps({
        "sheet": result["sheet"],
        "summary": result["summary"],
        "warnings": result["warnings"],
        "issues": json.loads(result["issues"].to_json(orient="records", force_ascii=False)),
        "table": result["table"],
    }, ensure_ascii=False)


def api_last_report():
    return to_js(_last_report)


def api_apply_edits(data, sheet, edits_json, changed_at):
    return to_js(apply_edits(bytes(data.to_py()), sheet, json.loads(edits_json), changed_at))
