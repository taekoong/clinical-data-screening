import re
from datetime import date, datetime
from io import BytesIO

import pandas as pd
from openpyxl import load_workbook

LOG_SHEET = "Change_Log"
LOG_HEADER = ["Changed_At", "Sheet", "Cell", "Column", "Before", "After", "Issue_Type"]

# 앞자리 0이 있는 값(예: 001)은 ID일 수 있으므로 숫자로 바꾸지 않는다
PLAIN_NUMBER = re.compile(r"^-?(0|[1-9]\d*)(\.\d+)?$")


# 입력한 글자를 엑셀에 넣을 값으로 변환: 숫자는 숫자로, 원래 날짜였던 셀은 날짜로
def convert_value(text, before):
    if text == "":
        return None

    if PLAIN_NUMBER.match(text):
        return float(text) if "." in text else int(text)

    if isinstance(before, (datetime, date)):
        parsed = pd.to_datetime(text.strip(), errors="coerce")
        if not pd.isna(parsed):
            return parsed.to_pydatetime()

    return text


def display(value):
    return "" if value is None else str(value)


def preview_recode(file_bytes, sheet, column, source, target):
    """정확히 일치하는 값만 찾아 수정 목록을 만든다. 원본은 변경하지 않는다."""
    if not isinstance(source, str) or not source.strip():
        raise ValueError("기존 값을 입력하세요. 결측값 채우기는 지원하지 않습니다.")
    if not isinstance(target, str) or not target.strip():
        raise ValueError("바꿀 값을 입력하세요. 빈 값으로 삭제할 수 없습니다.")
    if source == target:
        raise ValueError("기존 값과 바꿀 값이 같습니다.")
    book = load_workbook(BytesIO(file_bytes))
    if sheet == LOG_SHEET or sheet not in book.sheetnames:
        raise ValueError("재코딩할 데이터 시트를 선택하세요.")
    ws = book[sheet]
    columns = [cell.column for cell in ws[1] if display(cell.value) == column]
    if len(columns) != 1:
        raise ValueError("열 이름이 없거나 중복되어 있습니다.")
    edits = []
    for row in ws.iter_rows(min_row=2, min_col=columns[0], max_col=columns[0]):
        cell = row[0]
        if cell.value is None or cell.data_type == "f":
            continue
        if display(cell.value) == source:
            edits.append({
                "cell": cell.coordinate,
                "value": target,
                "issue": "CATEGORY_RECODE",
                "as_text": True,
                "expected_before": source,
            })
    return {"sheet": sheet, "column": column, "source": source, "target": target, "edits": edits}


# 원본 엑셀의 셀 값을 고치고, 고친 내역을 Change_Log 시트에 남긴다 (서식과 다른 시트는 그대로 유지)
def apply_edits(file_bytes, sheet, edits, changed_at=None):
    book = load_workbook(BytesIO(file_bytes))

    if sheet not in book.sheetnames:
        raise ValueError(f"시트 '{sheet}'가 파일에 없습니다.")

    ws = book[sheet]
    changed_at = changed_at or datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if LOG_SHEET in book.sheetnames:
        log = book[LOG_SHEET]
    else:
        log = book.create_sheet(LOG_SHEET)
        log.append(LOG_HEADER)

    for edit in edits:
        cell = ws[edit["cell"]]
        if cell.row == 1:
            raise ValueError(f"{edit['cell']}: 머리글(1행)은 수정할 수 없습니다.")

        before = cell.value
        if "expected_before" in edit and display(before) != edit["expected_before"]:
            raise ValueError(f"{cell.coordinate}: 미리보기 이후 값이 달라졌습니다. 다시 확인하세요.")
        if edit.get("as_text"):
            cell.value = edit["value"]
            cell.data_type = "s"  # 숫자 코드와 '='로 시작하는 범주도 입력한 텍스트 그대로 보관
        else:
            cell.value = convert_value(edit["value"], before)
        log.append([
            changed_at,
            sheet,
            cell.coordinate,
            display(ws.cell(row=1, column=cell.column).value),
            display(before),
            display(cell.value),
            edit.get("issue", ""),
        ])
        if edit.get("as_text"):
            for log_cell in log[log.max_row]:
                if isinstance(log_cell.value, str):
                    log_cell.data_type = "s"

    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()
