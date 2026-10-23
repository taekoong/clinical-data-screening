import pandas as pd

from validator import is_blank, is_numeric, parse_date

# 설정값에 따라 범주형 값 분포 확인 범위 변동
MAX_CATEGORIES = 10


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
        else:
            profile["examples"] = texts.drop_duplicates().head(5).tolist()

        profiles.append(profile)

    return profiles


def inspect_workbook(file_bytes, sheet=None, variable_types=None):
    from io import BytesIO

    book = pd.ExcelFile(BytesIO(file_bytes), engine="openpyxl")
    sheet = sheet or book.sheet_names[0]
    df = book.parse(sheet, dtype=object)
    variable_types = variable_types or {}

    continuous_summary = {}
    for column in df.columns:
        if variable_types.get(str(column)) == "continuous":
            continuous_summary[str(column)] = summarize_continuous(df[column])

    return {
        "sheets": book.sheet_names,
        "sheet": sheet,
        "rows": int(len(df)),
        "column_count": int(len(df.columns)),
        "columns": inspect_columns(df),
        "continuous_summary": continuous_summary,
    }

def summarize_continuous(series):
    texts = series[~series.map(is_blank)].astype(str).str.strip()
    numeric_mask = texts.map(is_numeric)
    numbers = texts[numeric_mask].astype(float)

    return {
        "valid_count": int(len(numbers)),
        "invalid_count": int((~numeric_mask).sum()),
        "mean": float(numbers.mean()) if not numbers.empty else None,
        "median": float(numbers.median()) if not numbers.empty else None,
        "std": float(numbers.std(ddof=1)) if len(numbers) >= 2 else None,
    }
