import operator
import re
from datetime import date, datetime

import pandas as pd
from openpyxl.utils import get_column_letter

ISSUE_COLUMNS = [
    "Sheet",
    "Excel_Row",
    "Column",
    "Cell",
    "Original_Value",
    "Issue_Type",
    "Severity",
    "Description",
    "Action"
]

def is_numeric(value):
    try:
        number = float(str(value).strip())
        return pd.notna(number) and number not in (float("inf"), float("-inf"))
    except (ValueError, TypeError):
        return False


def is_blank(value):
    return pd.isna(value) or str(value).strip() == ""

def get_cell(col_idx, row):
    return f"{get_column_letter(col_idx + 1)}{row}"


# 발견한 문제를 리포트에 기록
def add_issue(
    issues,
    *,
    sheet,
    row,
    column,
    cell,
    value,
    code,
    severity="REVIEW",
    detail=""
):
    issues.append({
        "Sheet": sheet,
        "Excel_Row": row,
        "Column": column,
        "Cell": cell,
        "Original_Value": "" if pd.isna(value) else str(value),
        "Issue_Type": code,
        "Severity": severity,
        "Description": detail,
        "Action": "연구자 확인 필요" if severity != "INFO" else "정보 확인",
    })


# 1. 공통 스크리닝(결측값, 앞뒤 공백, 데이터형식 오류)
def check_common(df, issues, sheet_name):
    for col_idx, col in enumerate(df.columns):
        series = df.iloc[:, col_idx]
        values = series.dropna().astype(str).str.strip()
        values = values[values != ""]

        # 완전히 비어 있는 컬럼
        if values.empty:
            add_issue(
                issues,
                sheet=sheet_name,
                row=1,
                column=str(col),
                cell=get_cell(col_idx, 1),
                value="",
                code="EMPTY_COLUMN",
                detail="데이터가 없는 컬럼입니다."
            )
            continue

        numeric_ratio = values.apply(is_numeric).mean()

        for idx, value in series.items():
            row = idx + 2
            cell = get_cell(col_idx, row)

            # 결측값 검사
            if is_blank(value):
                add_issue(
                    issues,
                    sheet=sheet_name,
                    row=row,
                    column=str(col),
                    cell=cell,
                    value=value,
                    code="MISSING_VALUE",
                    severity="INFO",
                    detail="값이 비어 있습니다."
                )
                continue

            text = str(value)

            # 앞뒤 공백 검사
            if text != text.strip():
                add_issue(
                    issues,
                    sheet=sheet_name,
                    row=row,
                    column=str(col),
                    cell=cell,
                    value=value,
                    code="EXTRA_WHITESPACE",
                    detail="값 앞뒤에 공백이 있습니다."
                )

            # 숫자형으로 추정되는 컬럼의 문자·기호 탐지
            if numeric_ratio >= 0.8 and not is_numeric(value):
                add_issue(
                    issues,
                    sheet=sheet_name,
                    row=row,
                    column=str(col),
                    cell=cell,
                    value=value,
                    code="SUSPECTED_TYPO",
                    detail=(
                        "대부분 숫자인 컬럼에서 숫자로 해석할 수 없는 "
                        "값이 발견되었습니다. 연구자 확인이 필요합니다."
                    )
                )


# 2. 연구별 숫자 범위 검사
def check_numeric_ranges(df, issues, sheet_name, numeric_rules):
    for col, limits in numeric_rules.items():
        if col not in df.columns:
            continue

        col_idx = df.columns.get_loc(col)

        for idx, value in df[col].items():
            if is_blank(value):
                continue

            row = idx + 2
            cell = get_cell(col_idx, row)

            if not is_numeric(value):
                add_issue(
                    issues,
                    sheet=sheet_name,
                    row=row,
                    column=col,
                    cell=cell,
                    value=value,
                    code="INVALID_NUMERIC_VALUE",
                    detail="숫자형 변수에 숫자로 해석할 수 없는 값이 있습니다."
                )
                continue

            number = float(str(value).strip())

            if not limits["min"] <= number <= limits["max"]:
                add_issue(
                    issues,
                    sheet=sheet_name,
                    row=row,
                    column=col,
                    cell=cell,
                    value=value,
                    code="OUT_OF_RANGE",
                    detail=(
                        f"설정된 허용 범위 "
                        f"{limits['min']}~{limits['max']}를 벗어났습니다."
                    )
                )


# 3. 연구별 범주형 허용값 검사
def check_categories(df, issues, sheet_name, categorical_rules):
    for col, allowed in categorical_rules.items():
        if col not in df.columns:
            continue

        col_idx = df.columns.get_loc(col)
        allowed_strings = {str(item) for item in allowed}

        for idx, value in df[col].items():
            if is_blank(value):
                continue

            text = str(value).strip()

            if text not in allowed_strings:
                row = idx + 2
                matched = match_category(text, allowed_strings)

                # 표기만 다르고 같은 뜻으로 보이는 값 (m → M, Yes → Y)
                if matched:
                    add_issue(
                        issues,
                        sheet=sheet_name,
                        row=row,
                        column=col,
                        cell=get_cell(col_idx, row),
                        value=value,
                        code="CATEGORY_VARIANT",
                        detail=f"'{matched}'의 다른 표기로 보입니다. 허용값: {', '.join(map(str, allowed))}"
                    )
                    continue

                add_issue(
                    issues,
                    sheet=sheet_name,
                    row=row,
                    column=col,
                    cell=get_cell(col_idx, row),
                    value=value,
                    code="INVALID_CATEGORY",
                    detail=f"허용값: {', '.join(map(str, allowed))}"
                )


# 허용값과 대소문자만 다르거나, 흔히 쓰는 단어 표기(Male, Yes 등)인 경우 해당 허용값을 반환
CATEGORY_WORDS = {"male", "female", "yes", "no"}


def match_category(text, allowed_strings):
    lowered = text.casefold()

    for item in allowed_strings:
        if lowered == item.casefold():
            return item

    if lowered in CATEGORY_WORDS:
        for item in allowed_strings:
            if len(item) == 1 and lowered[0] == item.casefold():
                return item

    return None


# 4. 문자형 컬럼 표기 통일성 검사 
def check_label_variants(df, issues, sheet_name, skip_columns):
    for col_idx, col in enumerate(df.columns):
        if col in skip_columns:
            continue

        series = df.iloc[:, col_idx]
        values = series[~series.map(is_blank)].astype(str).str.strip()

        if values.empty or values.map(is_numeric).mean() >= 0.8:
            continue

        # 대소문자를 무시하고 묶었을 때 가장 많이 쓰인 표기를 기준으로 삼음
        normalized = values.str.casefold()
        if normalized.nunique() > 20:
            continue

        standard = values.groupby(normalized).agg(lambda s: s.value_counts().idxmax())

        for idx, text in values.items():
            expected = standard[text.casefold()]
            if text == expected:
                continue

            row = idx + 2
            add_issue(
                issues,
                sheet=sheet_name,
                row=row,
                column=str(col),
                cell=get_cell(col_idx, row),
                value=series[idx],
                code="CATEGORY_VARIANT",
                detail=f"같은 컬럼의 '{expected}'와 대소문자 표기가 다릅니다."
            )


# 5. 대상자 ID 형식 검사
def check_id_format(df, issues, sheet_name, id_rule):
    col = id_rule.get("column")
    pattern = id_rule.get("pattern")

    if not col or not pattern or col not in df.columns:
        return

    col_idx = df.columns.get_loc(col)
    regex = re.compile(pattern)

    for idx, value in df[col].items():
        if is_blank(value):
            continue

        if not regex.fullmatch(str(value).strip()):
            row = idx + 2
            add_issue(
                issues,
                sheet=sheet_name,
                row=row,
                column=col,
                cell=get_cell(col_idx, row),
                value=value,
                code="INVALID_ID_FORMAT",
                severity="ERROR",
                detail=f"ID 형식이 규칙({pattern})과 다릅니다."
            )


# 6. 중복 레코드 검사
def check_duplicates(df, issues, sheet_name, key_columns):
    keys = [col for col in key_columns if col in df.columns]

    if not keys or len(keys) != len(key_columns):
        return

    key_values = df[keys].apply(lambda s: s.map(lambda v: "" if is_blank(v) else str(v).strip()))

    # 키 값이 비어 있는 행은 결측값으로 보고되므로 제외
    has_key = (key_values != "").all(axis=1)
    duplicated = key_values[has_key].duplicated(keep=False)
    col_idx = df.columns.get_loc(keys[0])

    for _, group in key_values[has_key][duplicated].groupby(keys):
        rows = [idx + 2 for idx in group.index]

        for idx in group.index[1:]:
            row = idx + 2
            label = ", ".join(f"{col}={key_values.at[idx, col]}" for col in keys)
            add_issue(
                issues,
                sheet=sheet_name,
                row=row,
                column=keys[0],
                cell=get_cell(col_idx, row),
                value=df.at[idx, keys[0]],
                code="DUPLICATE_RECORD",
                severity="ERROR",
                detail=f"{label} 조합이 중복됩니다. (중복 행: {', '.join(map(str, rows))})"
            )


def parse_date(value):
    if isinstance(value, (pd.Timestamp, datetime, date)):
        return pd.Timestamp(value)

    return pd.to_datetime(str(value).strip(), errors="coerce")


# 7. 날짜 검사 (날짜 형식, 연구 기간)
def check_dates(df, issues, sheet_name, date_rules):

    for col, limits in date_rules.items():
        if col not in df.columns:
            continue

        col_idx = df.columns.get_loc(col)
        start = pd.Timestamp(limits["min"]) if limits.get("min") else None
        end = pd.Timestamp(limits["max"]) if limits.get("max") else None

        for idx, value in df[col].items():
            if is_blank(value):
                continue

            row = idx + 2
            cell = get_cell(col_idx, row)
            parsed = parse_date(value)

            if pd.isna(parsed):
                add_issue(
                    issues,
                    sheet=sheet_name,
                    row=row,
                    column=col,
                    cell=cell,
                    value=value,
                    code="INVALID_DATE",
                    severity="ERROR",
                    detail="날짜로 해석할 수 없는 값입니다."
                )
                continue

            if (start is not None and parsed < start) or (end is not None and parsed > end):
                add_issue(
                    issues,
                    sheet=sheet_name,
                    row=row,
                    column=col,
                    cell=cell,
                    value=value,
                    code="DATE_OUT_OF_PERIOD",
                    detail=(
                        f"연구 기간 {limits.get('min') or '-'}~"
                        f"{limits.get('max') or '-'}을 벗어났습니다."
                    )
                )


# 8. 컬럼 간 논리 검사
COMPARISON_OPERATORS = {
    ">": operator.gt,
    ">=": operator.ge,
    "<": operator.lt,
    "<=": operator.le,
    "==": operator.eq,
    "!=": operator.ne,
}


def check_cross_columns(df, issues, sheet_name, cross_checks):
    for check in cross_checks:
        left = check["left"]
        right = check["right"]
        op = COMPARISON_OPERATORS[check["op"]]

        right_is_column = isinstance(right, str)

        if left not in df.columns or (right_is_column and right not in df.columns):
            continue

        col_idx = df.columns.get_loc(left)
        rule_text = f"{left} {check['op']} {right}"

        for idx, left_value in df[left].items():
            right_value = df.at[idx, right] if right_is_column else right

            if not is_numeric(left_value) or not is_numeric(right_value):
                continue

            if op(float(str(left_value).strip()), float(str(right_value).strip())):
                continue

            row = idx + 2
            compared = f"{left}={left_value}, {right}={right_value}" if right_is_column else f"{left}={left_value}"
            add_issue(
                issues,
                sheet=sheet_name,
                row=row,
                column=left,
                cell=get_cell(col_idx, row),
                value=left_value,
                code="CROSS_CHECK_FAILED",
                detail=check.get("detail") or f"{rule_text} 조건을 만족하지 않습니다. ({compared})"
            )


# 전체 데이터 스크리닝
def validate_data(df, rules=None, sheet_name="Raw_Data"):
    issues = []
    rules = rules or {}
    categorical_rules = rules.get("categorical_columns", {})
    id_rule = rules.get("id_column", {})
    date_rules = rules.get("date_columns", {})

    skip_columns = set(categorical_rules) | set(date_rules)
    if id_rule.get("column"):
        skip_columns.add(id_rule["column"])

    check_common(df, issues, sheet_name)
    check_numeric_ranges(df, issues, sheet_name, rules.get("numeric_columns", {}))
    check_categories(df, issues, sheet_name, categorical_rules)
    check_label_variants(df, issues, sheet_name, skip_columns)
    check_id_format(df, issues, sheet_name, id_rule)
    check_duplicates(df, issues, sheet_name, rules.get("duplicate_keys", []))
    check_dates(df, issues, sheet_name, date_rules)
    check_cross_columns(df, issues, sheet_name, rules.get("cross_checks", []))

    return pd.DataFrame(issues, columns=ISSUE_COLUMNS)
