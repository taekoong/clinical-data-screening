import re

import pandas as pd

from validator import COMPARISON_OPERATORS

KNOWN_KEYS = {
    "numeric_columns",
    "categorical_columns",
    "id_column",
    "duplicate_keys",
    "date_columns",
    "cross_checks",
}


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def is_valid_date(value):
    return isinstance(value, str) and not pd.isna(pd.to_datetime(value, errors="coerce"))


# 규칙 구조 검증: 검사를 돌릴 수 없는 오류 목록을 반환 (비어 있으면 정상)
def validate_rules(rules):
    errors = []

    if not isinstance(rules, dict):
        return ["규칙은 JSON 객체({ ... })여야 합니다."]

    for key in rules:
        if key not in KNOWN_KEYS:
            errors.append(f"알 수 없는 항목 '{key}'입니다. 사용 가능: {', '.join(sorted(KNOWN_KEYS))}")

    for col, limits in rules.get("numeric_columns", {}).items():
        where = f"numeric_columns.{col}"
        if not isinstance(limits, dict) or not is_number(limits.get("min")) or not is_number(limits.get("max")):
            errors.append(f"{where}: min과 max에 숫자를 입력해야 합니다.")
        elif limits["min"] > limits["max"]:
            errors.append(f"{where}: min({limits['min']})이 max({limits['max']})보다 큽니다.")

    for col, allowed in rules.get("categorical_columns", {}).items():
        if not isinstance(allowed, list) or not allowed:
            errors.append(f"categorical_columns.{col}: 허용값을 하나 이상 입력해야 합니다.")

    id_rule = rules.get("id_column", {})
    if id_rule:
        if not id_rule.get("column"):
            errors.append("id_column.column: ID 컬럼을 지정해야 합니다.")
        try:
            re.compile(id_rule.get("pattern") or "")
        except re.error as e:
            errors.append(f"id_column.pattern: 정규식 오류 ({e})")
        if not id_rule.get("pattern"):
            errors.append("id_column.pattern: ID 형식을 입력해야 합니다.")

    keys = rules.get("duplicate_keys", [])
    if not isinstance(keys, list) or not all(isinstance(k, str) and k for k in keys):
        errors.append("duplicate_keys: 컬럼 이름 목록이어야 합니다.")

    for col, limits in rules.get("date_columns", {}).items():
        where = f"date_columns.{col}"
        if not isinstance(limits, dict):
            errors.append(f"{where}: 기간을 {{\"min\": ..., \"max\": ...}} 형태로 입력해야 합니다.")
            continue
        for bound in ("min", "max"):
            if limits.get(bound) and not is_valid_date(limits[bound]):
                errors.append(f"{where}.{bound}: 날짜 형식(YYYY-MM-DD)이 아닙니다.")
        if is_valid_date(limits.get("min")) and is_valid_date(limits.get("max")) \
                and pd.Timestamp(limits["min"]) > pd.Timestamp(limits["max"]):
            errors.append(f"{where}: 시작일이 종료일보다 늦습니다.")

    for i, check in enumerate(rules.get("cross_checks", []), start=1):
        where = f"cross_checks {i}번째"
        if not isinstance(check, dict) or not check.get("left"):
            errors.append(f"{where}: 왼쪽 컬럼(left)을 지정해야 합니다.")
            continue
        if check.get("op") not in COMPARISON_OPERATORS:
            errors.append(f"{where}: 연산자는 {' '.join(COMPARISON_OPERATORS)} 중 하나여야 합니다.")
        right = check.get("right")
        if not (is_number(right) or (isinstance(right, str) and right)):
            errors.append(f"{where}: 오른쪽(right)에 컬럼 이름이나 숫자를 입력해야 합니다.")

    return errors

def check_rules_against_data(df, rules):
    columns = set(map(str, df.columns))
    warnings = []

    def missing(col, label):
        if col not in columns:
            warnings.append(f"규칙의 컬럼 '{col}'이 데이터에 없어 {label}를 건너뜁니다.")

    for col in rules.get("numeric_columns", {}):
        missing(col, "숫자 범위 검사")
    for col in rules.get("categorical_columns", {}):
        missing(col, "범주형 허용값 검사")
    if rules.get("id_column", {}).get("column"):
        missing(rules["id_column"]["column"], "ID 형식 검사")
    for col in rules.get("duplicate_keys", []):
        missing(col, "중복 레코드 검사")
    for col in rules.get("date_columns", {}):
        missing(col, "날짜 검사")
    for check in rules.get("cross_checks", []):
        missing(check["left"], "컬럼 간 논리 검사")
        if isinstance(check["right"], str):
            missing(check["right"], "컬럼 간 논리 검사")

    return warnings
