import re

import pandas as pd

from validator import cell_text, is_blank, is_numeric, parse_date

# 설정값에 따라 범주형 값 분포 확인 범위 변동
MAX_CATEGORIES = 10


# 숫자지만 값 종류가 이 정도 이하면 0/1, 1/2/3처럼 코드화된 범주로 본다
MAX_CODED_LEVELS = 5
ID_NAME = re.compile(r"(^|[_\s])(id|no|num|number)$|^id[_\s]|번호|식별", re.IGNORECASE)


# 변수 유형 추천과 그 이유 (연구자가 [변수 요약] 탭에서 바꿀 수 있다)
def suggest_type(profile):
    name, kind = profile["column"], profile["type"]
    filled, unique = profile["filled"], profile["unique"]
    all_unique = filled > MAX_CATEGORIES and unique == filled

    if kind == "empty":
        return "exclude", "값이 하나도 없음"
    # 숫자로 된 ID(1001, 001 …)도 있으므로 이름이 ID 형태이고 값 종류가 많으면 ID로 본다
    if ID_NAME.search(name) and unique > MAX_CODED_LEVELS:
        return "identifier", "이름이 ID 형태이고 값이 행마다 다름" if unique == filled else "이름이 ID 형태"
    if kind == "numeric":
        if unique <= MAX_CODED_LEVELS:
            return "categorical", f"숫자지만 값이 {unique}종류뿐이라 코드화된 범주로 추정"
        return "continuous", "대부분 숫자"
    if kind == "date":
        return "date", "대부분 날짜"
    if kind == "categorical":
        return "categorical", f"값이 {unique}종류"
    if all_unique:
        return "identifier", "값이 행마다 모두 다름"
    return "text", f"값이 {unique}종류로 많아 자유 텍스트로 추정"


# 컬럼별 데이터 분석
def inspect_columns(df):
    profiles = []

    for col in df.columns:
        series = df[col]
        values = series[~series.map(is_blank)]
        texts = values.astype(str).str.strip()
        profile = {
            "column": str(col),
            "dtype": str(series.dtype),
            "filled": int(len(values)),
            "missing": int(len(series) - len(values)),
            "missing_percent": (
                round((len(series)-len(values))/len(series) *100 , 2)
                if len(series) > 0 else 0.0
                ),
            "unique": int(texts.nunique()),
            "type": "text",
        }

        if values.empty:
            profile["type"] = "empty"
            profiles.append(profile)
            continue

        raw_counts = values.map(cell_text).value_counts()
        if len(raw_counts) <= MAX_CATEGORIES:
            profile["raw_values"] = {key: int(count) for key, count in raw_counts.items()}

        if texts.nunique() > MAX_CATEGORIES:
            profile["examples"] = texts.drop_duplicates().head(5).tolist()

        numeric_mask = texts.map(is_numeric)
        dates = values.map(parse_date)

        if numeric_mask.mean() >= 0.8:
            numbers = texts[numeric_mask].astype(float)
            profile.update({
                "type": "numeric",
                "min": float(numbers.min()),
                "max": float(numbers.max()),
                "invalid": int((~numeric_mask).sum()),
            })
            if texts.nunique() <= MAX_CATEGORIES:
                profile["values"] = {str(k): int(v) for k, v in texts.value_counts().items()}
        elif dates.notna().mean() >= 0.8:
            valid = dates.dropna()
            profile.update({
                "type": "date",
                "min": valid.min().date().isoformat(),
                "max": valid.max().date().isoformat(),
                "invalid": int(dates.isna().sum()),
            })
        elif texts.nunique() <= MAX_CATEGORIES:
            counts = texts.value_counts()
            profile.update({
                "type": "categorical",
                "values": {str(k): int(v) for k, v in counts.items()},
            })

        profiles.append(profile)

    for profile in profiles:
        profile["suggested"], profile["reason"] = suggest_type(profile)

    return profiles


def inspect_workbook(file_bytes, sheet=None):
    from io import BytesIO

    book = pd.ExcelFile(BytesIO(file_bytes), engine="openpyxl")
    sheet = sheet or book.sheet_names[0]
    df = book.parse(sheet, dtype=object)

    return {
        "sheets": book.sheet_names,
        "sheet": sheet,
        "rows": int(len(df)),
        "column_count": int(len(df.columns)),
        "columns": inspect_columns(df),
    }
