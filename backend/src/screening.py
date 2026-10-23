import json
from io import BytesIO

import pandas as pd

from rules import check_rules_against_data, validate_rules
from validator import cell_text, validate_data


class RulesError(ValueError):
    def __init__(self, errors):
        super().__init__("\n".join(errors))
        self.errors = errors


def read_sheet(file_bytes, sheet=None):
    book = pd.ExcelFile(BytesIO(file_bytes), engine="openpyxl")
    sheet = sheet or book.sheet_names[0]
    return book.parse(sheet, dtype=object), sheet


def build_summary(df, issues, rules):
    by_severity = issues["Severity"].value_counts()
    return {
        "total_rows": int(len(df)),
        "total_columns": int(len(df.columns)),
        "issue_count": int(len(issues)),
        "by_severity": {level: int(by_severity.get(level, 0)) for level in ("ERROR", "REVIEW", "INFO")},
        "rules_applied": bool(rules),
    }


# 결과 - 요약, 문제 목록, 사용한 규칙, 원본 데이터
def build_report(df, issues, rules, summary, warnings, sheet):
    summary_rows = [
        {"Metric": "Sheet", "Value": sheet},
        {"Metric": "Total Rows", "Value": summary["total_rows"]},
        {"Metric": "Total Columns", "Value": summary["total_columns"]},
        {"Metric": "Detected Issues", "Value": summary["issue_count"]},
        *({"Metric": level, "Value": count} for level, count in summary["by_severity"].items()),
        {"Metric": "Rules Applied", "Value": summary["rules_applied"]},
        *({"Metric": "Warning", "Value": text} for text in warnings),
    ]
    rules_text = json.dumps(rules or {}, ensure_ascii=False, indent=2).splitlines()

    buffer = BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        pd.DataFrame(summary_rows).to_excel(writer, sheet_name="Summary", index=False)
        issues.to_excel(writer, sheet_name="Issues", index=False)
        pd.DataFrame({"Rules (JSON)": rules_text}).to_excel(writer, sheet_name="Rules", index=False)
        df.to_excel(writer, sheet_name="Raw_Data", index=False)

    return buffer.getvalue()


def run_screening(file_bytes, rules=None, sheet=None):
    rules = rules or {}
    errors = validate_rules(rules)
    if errors:
        raise RulesError(errors)

    df, sheet = read_sheet(file_bytes, sheet)
    warnings = check_rules_against_data(df, rules)
    issues = validate_data(df, rules, sheet_name=sheet)
    summary = build_summary(df, issues, rules)

    return {
        "sheet": sheet,
        "summary": summary,
        "warnings": warnings,
        "issues": issues,
        "table": sheet_table(df),
        "report": build_report(df, issues, rules, summary, warnings, sheet),
    }
