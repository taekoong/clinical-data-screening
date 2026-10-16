
import pandas as pd
from openpyxl.utils import get_column_letter

def is_numeric(value):
    try:
        number = float(str(value).strip())
        return pd.notna(number) and number not in (float("inf"), float("-inf"))
    except (ValueError, TypeError):
        return False


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


# 전체 데이터 스크리닝
def validate_data(df, rules=None, sheet_name="Raw_Data"):
    issues = []
    rules = rules or {}

    def get_cell(col_idx, row):
        return f"{get_column_letter(col_idx + 1)}{row}"

    # 1. 공통 스크리닝
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

        # 숫자 형태 데이터 비율 계산
        numeric_ratio = values.apply(is_numeric).mean()

        for idx, value in series.items():
            row = idx + 2
            cell = get_cell(col_idx, row)

            # 결측값 검사
            if pd.isna(value) or str(value).strip() == "":
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
    for col, limits in rules.get("numeric_columns", {}).items():
        if col not in df.columns:
            continue

        col_idx = df.columns.get_loc(col)

        for idx, value in df[col].items():
            if pd.isna(value) or str(value).strip() == "":
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
    for col, allowed in rules.get("categorical_columns", {}).items():
        if col not in df.columns:
            continue

        col_idx = df.columns.get_loc(col)
        allowed_strings = {str(item) for item in allowed}

        for idx, value in df[col].items():
            if pd.isna(value) or str(value).strip() == "":
                continue

            if str(value).strip() not in allowed_strings:
                row = idx + 2

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

    return pd.DataFrame(
        issues,
        columns=[
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
    )
