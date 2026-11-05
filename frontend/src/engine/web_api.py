# 브라우저(Pyodide)에서 호출하는 진입점. 검사 로직은 프로젝트 backend/src/의 Python 코드를 그대로 사용한다.
import json

from pyodide.ffi import to_js

from editor import apply_edits, preview_recode
from inspector import inspect_workbook
from rules import validate_rules
from screening import RulesError, run_screening
from variables import describe_workbook, export_variables, build_r_script, export_analysis

_last_report = None


def api_preview_recode(data, sheet, column, source, target):
    return json.dumps(
        preview_recode(bytes(data.to_py()), sheet, column, source, target),
        ensure_ascii=False,
    )


def api_inspect(data, sheet):
    return json.dumps(inspect_workbook(bytes(data.to_py()), sheet or None), ensure_ascii=False)

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


def api_describe(data, sheet, variables_json, rules_json, exclude_out_of_range):
    return json.dumps(describe_workbook(
        bytes(data.to_py()), sheet, json.loads(variables_json), json.loads(rules_json), exclude_out_of_range,
    ), ensure_ascii=False)


def api_export_variables(data, sheet, variables_json, plan_json, include_data, rules_json, exclude_out_of_range):
    return to_js(export_variables(
        bytes(data.to_py()), sheet, json.loads(variables_json), json.loads(plan_json), include_data,
        json.loads(rules_json), exclude_out_of_range,
    ))

def api_export_analysis(data, sheet, codebook_json):
    return to_js(export_analysis(bytes(data.to_py()), sheet, json.loads(codebook_json)))

def api_r_script(file_name, codebook_json):
    return build_r_script(file_name, json.loads(codebook_json))
