import pandas as pd

from validator import is_blank, is_numeric, parse_date

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
            "filled": int(len(values)),
            "missing": int(len(series) - len(values)),
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
            profile["unique"] = int(texts.nunique())
            profile["examples"] = texts.drop_duplicates().head(5).tolist()

        profiles.append(profile)

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
        "columns": inspect_columns(df),
    }
