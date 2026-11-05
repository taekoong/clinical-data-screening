import math
from io import BytesIO

import pandas as pd
from openpyxl import Workbook, load_workbook

from validator import cell_text, is_blank, is_numeric, parse_date

VARIABLE_TYPES = ("continuous", "categorical", "date", "identifier", "text")
CONTINUOUS_SHEET = "Continuous_Summary"
FREQUENCY_SHEET = "Frequencies"
OTHER_SHEET = "Other_Variables"
CODEBOOK_SHEET = "Codebook"


def read_sheet(file_bytes, sheet):
    return pd.read_excel(BytesIO(file_bytes), sheet_name=sheet, dtype=object, engine="openpyxl")


def number_or_none(value):
    """NaN이나 무한대처럼 JSON·엑셀에 쓸 수 없는 값은 None으로"""
    if value is None or not math.isfinite(value):
        return None
    return float(value)


def plain_number(value):
    """코드 값: 정수로 떨어지면 int (1.0 → 1)"""
    number = float(value)
    return int(number) if number.is_integer() else number


# 연속형 변수: 숫자로 읽히는 값만 계산에 쓰고, 숫자가 아닌 값(17O 등)은 따로 센다
def numeric_parts(series):
    filled = series[~series.map(is_blank)]
    mask = filled.map(is_numeric)
    numbers = filled[mask].map(lambda value: float(str(value).strip())).astype(float)
    invalid = filled[~mask].map(cell_text)
    return numbers, invalid


# 규칙(규칙 편집 탭과 같은 JSON)에 적힌 숫자 범위·날짜 기간. 없으면 (None, None)
def rule_limits(rules, key, column):
    limits = (rules or {}).get(key, {}).get(column) or {}
    return limits.get("min"), limits.get("max")


def outside(value, low, high):
    return (low is not None and value < low) or (high is not None and value > high)


def describe_continuous(series, low=None, high=None, exclude=False):
    numbers, invalid = numeric_parts(series)
    out_mask = numbers.map(lambda v: outside(v, low, high)).astype(bool)
    out = numbers[out_mask]
    if exclude:
        numbers = numbers[~out_mask]
    stats = {
        "range_min": low,
        "range_max": high,
        "out_of_range": int(len(out)),
        "out_of_range_examples": [plain_number(v) for v in out.drop_duplicates().sort_values().head(5)],
        "excluded": bool(exclude and len(out)),
        "valid": int(len(numbers)),
        "invalid": int(len(invalid)),
        "invalid_examples": invalid.drop_duplicates().head(5).tolist(),
        "values": numbers.tolist(),  # 화면에서 구간별 개수를 바로 보여 주기 위해 넘긴다
    }
    for name, value in {
        "mean": numbers.mean(),
        "std": numbers.std(ddof=1),
        "min": numbers.min(),
        "q1": numbers.quantile(0.25),
        "median": numbers.median(),
        "q3": numbers.quantile(0.75),
        "max": numbers.max(),
        "skewness": numbers.skew(),   # 엑셀 SKEW와 같은 표본 왜도 (3개 이상 필요)
        "kurtosis": numbers.kurt(),   # 엑셀 KURT와 같은 초과 첨도 (4개 이상 필요)
    }.items():
        stats[name] = number_or_none(value) if len(numbers) else None
    return stats

def validate_codebook(codebook):
    errors = []
    for column, levels in codebook.items():
        codes, sources = set(), set()
        for level in levels:
            code = level.get("code")
            if not is_numeric(code):
                errors.append(f"{column}: 코드는 숫자여야 합니다 ({code}).")
            elif float(code) in codes:
                errors.append(f"{column}: 코드 {code}이 중복됩니다.")
            else:
                codes.add(float(code))

            if not str(level.get("label", "")).strip():
                errors.append(f"{column}: 코드 {code}의 라벨을 입력하세요.")
            if not level.get("sources"):
                errors.append(f"{column}: 코드 {code}에 연결된 원본 값이 없습니다.")

            for source in level.get("sources", []):
                if source in sources:
                    errors.append(f"{column}: 원본 값 '{source}'이 두 코드에 들어있습니다. ")
                sources.add(source)
    return errors

# 범주형 변수: 값은 원본 그대로 센다 (" M"과 "M"은 다른 값으로 보여 줘야 표기 문제가 드러난다)
def level_sort_key(value):
    return (0, float(value), "") if is_numeric(value) else (1, 0.0, value)


def describe_categorical(series):
    texts = series[~series.map(is_blank)].map(cell_text)
    counts = texts.value_counts()
    total = int(counts.sum())
    levels = [
        {"value": value, "count": int(counts[value]), "percent": round(counts[value] / total * 100, 1)}
        for value in sorted(counts.index, key=level_sort_key)
    ]
    return {"levels": levels}


# 날짜: 기간과 날짜로 읽히지 않는 값
def describe_date(series, first=None, last=None):
    filled = series[~series.map(is_blank)]
    dates = filled.map(parse_date)
    valid = dates.dropna()
    invalid = filled[dates.isna()].map(cell_text)
    low = pd.Timestamp(first) if first else None
    high = pd.Timestamp(last) if last else None
    out = valid[valid.map(lambda d: outside(d.normalize(), low, high)).astype(bool)]
    return {
        "range_min": first,
        "range_max": last,
        "out_of_range": int(len(out)),
        "out_of_range_examples": sorted({d.date().isoformat() for d in out})[:5],
        "valid": int(len(valid)),
        "invalid": int(len(invalid)),
        "invalid_examples": invalid.drop_duplicates().head(5).tolist(),
        "first": valid.min().date().isoformat() if len(valid) else None,
        "last": valid.max().date().isoformat() if len(valid) else None,
    }


# ID: 대상자 수와 여러 행에 나오는 ID (반복 측정이면 정상, 아니면 중복 입력)
def describe_identifier(series):
    texts = series[~series.map(is_blank)].map(cell_text)
    counts = texts.value_counts()
    repeated = counts[counts > 1]
    return {
        "unique": int(len(counts)),
        "repeated": int(len(repeated)),
        "max_rows": int(counts.max()) if len(counts) else 0,
        "repeated_examples": [{"value": value, "count": int(count)} for value, count in repeated.head(5).items()],
    }


# 자유 텍스트: 자주 나오는 값만 보여 준다
def describe_text(series):
    texts = series[~series.map(is_blank)].map(cell_text)
    counts = texts.value_counts()
    return {
        "unique": int(len(counts)),
        "top": [{"value": value, "count": int(count)} for value, count in counts.head(5).items()],
    }


DESCRIBERS = {
    "continuous": describe_continuous,
    "categorical": describe_categorical,
    "date": describe_date,
    "identifier": describe_identifier,
    "text": describe_text,
}


def describe_variables(df, variables, rules=None, exclude_out_of_range=False):
    """variables: {컬럼: 유형} (선택한 순서대로). 유형은 VARIABLE_TYPES 중 하나
    rules: 규칙 JSON. 숫자 범위·날짜 기간 밖의 값을 세고, exclude_out_of_range면 연속형 계산에서 뺀다"""
    results = []
    for column, kind in variables.items():
        if column not in df.columns:
            continue
        series = df[column]
        missing = int(series.map(is_blank).sum())
        base = {
            "column": column,
            "type": kind,
            "n": int(len(series)),
            "missing": missing,
            "missing_percent": round(missing / len(series) * 100, 1) if len(series) else 0.0,
        }
        if kind not in DESCRIBERS:
            raise ValueError(f"{column}: 알 수 없는 변수 유형 '{kind}'")
        if kind == "continuous":
            low, high = rule_limits(rules, "numeric_columns", column)
            details = describe_continuous(series, low, high, exclude_out_of_range)
        elif kind == "date":
            details = describe_date(series, *rule_limits(rules, "date_columns", column))
        else:
            details = DESCRIBERS[kind](series)
        results.append({**base, **details})
    return results


def describe_workbook(file_bytes, sheet, variables, rules=None, exclude_out_of_range=False):
    return describe_variables(read_sheet(file_bytes, sheet), variables, rules, exclude_out_of_range)


# ---------- 코딩 (구간 나누기, 숫자 코드) ----------

def bin_labels(cuts, right_closed):
    def fmt(number):
        return f"{plain_number(number)}"

    if right_closed:
        first, middle, last = "{0} 이하", "{0} 초과 {1} 이하", "{0} 초과"
    else:
        first, middle, last = "{0} 미만", "{0} 이상 {1} 미만", "{0} 이상"
    labels = [first.format(fmt(cuts[0]))]
    labels += [middle.format(fmt(a), fmt(b)) for a, b in zip(cuts, cuts[1:])]
    labels.append(last.format(fmt(cuts[-1])))
    return labels


def validate_plan(df, variables, plan):
    errors = []
    existing = {str(column) for column in df.columns}
    new_columns = []

    for column, kind in variables.items():
        if kind not in VARIABLE_TYPES:
            errors.append(f"{column}: 알 수 없는 변수 유형 '{kind}'")
        if column not in existing:
            errors.append(f"{column}: 데이터에 없는 컬럼입니다.")

    def check_target(item, kind):
        column = item.get("column")
        new_column = str(item.get("new_column", "")).strip()
        if variables.get(column) != kind:
            label = "연속형" if kind == "continuous" else "범주형"
            errors.append(f"{column}: {label}으로 선택한 변수가 아닙니다.")
        if not new_column:
            errors.append(f"{column}: 새 컬럼 이름을 입력하세요.")
        elif new_column in existing:
            errors.append(f"{column}: 새 컬럼 이름 '{new_column}'이 데이터에 이미 있습니다.")
        elif new_column in new_columns:
            errors.append(f"{column}: 새 컬럼 이름 '{new_column}'이 중복됩니다.")
        new_columns.append(new_column)

    for item in plan.get("bins", []):
        check_target(item, "continuous")
        cuts, codes = item.get("cuts", []), item.get("codes", [])
        column = item.get("column")
        if not cuts or not all(is_numeric(cut) for cut in cuts):
            errors.append(f"{column}: 구간 기준값은 숫자로 하나 이상 입력하세요.")
        elif any(float(a) >= float(b) for a, b in zip(cuts, cuts[1:])):
            errors.append(f"{column}: 구간 기준값은 작은 값부터 겹치지 않게 입력하세요.")
        elif len(codes) != len(cuts) + 1 or not all(is_numeric(code) for code in codes):
            errors.append(f"{column}: 구간마다 숫자 코드를 입력하세요.")
        elif len({float(code) for code in codes}) != len(codes):
            errors.append(f"{column}: 구간 코드가 중복됩니다.")

    for item in plan.get("codes", []):
        check_target(item, "categorical")
        mapping = item.get("mapping", {})
        if not mapping:
            errors.append(f"{item.get('column')}: 코드를 하나 이상 입력하세요.")
        bad = [value for value, code in mapping.items() if not is_numeric(code)]
        if bad:
            errors.append(f"{item.get('column')}: 숫자가 아닌 코드가 있습니다 ({', '.join(bad[:3])}).")

    return errors


def code_bins(series, item, low=None, high=None):
    cuts = [float(cut) for cut in item["cuts"]]
    codes = [plain_number(code) for code in item["codes"]]
    right_closed = bool(item.get("right_closed", False))
    # 범위 밖 값을 요약에서 뺀 경우 코드도 빈칸으로 둔다 (low/high는 그때만 넘어온다)
    numbers = pd.Series(
        [float(str(v).strip()) if not is_blank(v) and is_numeric(v) else math.nan for v in series],
        index=series.index,
    )
    numbers[numbers.map(lambda v: not math.isnan(v) and outside(v, low, high)).astype(bool)] = math.nan
    groups = pd.cut(numbers, bins=[-math.inf, *cuts, math.inf], right=right_closed, labels=False)
    coded = groups.map(lambda g: None if pd.isna(g) else codes[int(g)])
    codebook = [
        {"Code": code, "Meaning": label}
        for code, label in zip(codes, bin_labels(cuts, right_closed))
    ]
    return coded, codebook


# 범주 값에 숫자 코드를 붙인다 (M → 1)
def code_categories(series, item):
    mapping = {value: plain_number(code) for value, code in item["mapping"].items()}
    codebook = [{"Code": code, "Meaning": value} for value, code in mapping.items()]
    coded = series.map(lambda v: None if is_blank(v) else mapping.get(cell_text(v)))
    return coded, codebook

def apply_codebook(series, levels):
    mapping = {
        source: plain_number(level["code"])
        for level in levels
        for source in level["sources"]
    }

    def convert(value):
        if is_blank(value):
            return None
        return mapping.get(cell_text(value), value)
    return series.map(convert)

def build_coding(df, plan, rules=None, exclude_out_of_range=False):
    """새 컬럼 값과 코드북을 만든다. 코드가 없는 값은 빈칸으로 두고 개수를 알려 준다."""
    columns, codebook, warnings = {}, [], []
    for kind, items in (("bins", plan.get("bins", [])), ("codes", plan.get("codes", []))):
        for item in items:
            series = df[item["column"]]
            if kind == "bins":
                limits = rule_limits(rules, "numeric_columns", item["column"]) if exclude_out_of_range else (None, None)
                coded, book = code_bins(series, item, *limits)
            else:
                coded, book = code_categories(series, item)
            new_column = item["new_column"].strip()
            columns[new_column] = coded
            rule = "구간" if kind == "bins" else "범주 코드"
            codebook += [{"New_Column": new_column, "Source_Column": item["column"], "Rule": rule, **row} for row in book]

            uncoded = int((coded.isna() & ~series.map(is_blank)).sum())
            if uncoded:
                reason = "숫자가 아닌 값" if kind == "bins" else "코드를 정하지 않은 값"
                warnings.append(f"{new_column}: {reason} {uncoded}개는 빈칸으로 두었습니다.")
    return columns, codebook, warnings


# ---------- 엑셀로 내보내기 ----------

def range_text(low, high):
    if low is None and high is None:
        return ""
    return f"{'' if low is None else low} ~ {'' if high is None else high}"


def summary_frames(stats):
    continuous = [
        {
            "Variable": s["column"], "N": s["n"], "Missing": s["missing"], "Missing_%": s["missing_percent"],
            "Non_Numeric": s["invalid"],
            # 연구자가 정한 범위와 그 밖의 값 (Excluded=True면 아래 통계에서 뺐다)
            "Allowed_Range": range_text(s["range_min"], s["range_max"]),
            "Out_of_Range": s["out_of_range"], "Excluded": s["excluded"], "Valid": s["valid"],
            "Mean": s["mean"], "SD": s["std"], "Median": s["median"], "Q1": s["q1"], "Q3": s["q3"],
            "Min": s["min"], "Max": s["max"], "Skewness": s["skewness"], "Kurtosis": s["kurtosis"],
        }
        for s in stats if s["type"] == "continuous"
    ]
    frequencies = []
    for s in stats:
        if s["type"] != "categorical":
            continue
        frequencies += [
            {
                "Variable": s["column"], "Value": level["value"],
                "Count": level["count"], "Percent": level["percent"],
            }
            for level in s["levels"]
        ]
        frequencies.append({"Variable": s["column"], "Value": "(결측)", "Count": s["missing"], "Percent": None})
    type_names = {"date": "날짜", "identifier": "ID", "text": "텍스트"}
    other = []
    for s in stats:
        if s["type"] not in type_names:
            continue
        if s["type"] == "date":
            detail = f"{s['first']} ~ {s['last']}, 날짜 아님 {s['invalid']}개"
            if s["range_min"] or s["range_max"]:
                detail += f", 기간({range_text(s['range_min'], s['range_max'])}) 밖 {s['out_of_range']}개"
        elif s["type"] == "identifier":
            detail = f"고유 {s['unique']}개, 여러 행에 나오는 ID {s['repeated']}개 (최대 {s['max_rows']}행)"
        else:
            detail = f"고유 {s['unique']}개"
        other.append({
            "Variable": s["column"], "Type": type_names[s["type"]], "N": s["n"],
            "Missing": s["missing"], "Missing_%": s["missing_percent"], "Detail": detail,
        })
    return pd.DataFrame(continuous), pd.DataFrame(frequencies), pd.DataFrame(other)


def write_frame(book, name, frame):
    if name in book.sheetnames:
        del book[name]
    ws = book.create_sheet(name)
    ws.append(list(frame.columns))
    for row in frame.itertuples(index=False):
        ws.append([None if isinstance(v, float) and math.isnan(v) else v for v in row])


def export_variables(file_bytes, sheet, variables, plan, include_data=True, rules=None, exclude_out_of_range=False):
    """include_data=True: 원본 파일에 새 컬럼과 요약·코드북 시트를 더한 파일
    include_data=False: 요약 시트만 담은 파일"""
    df = read_sheet(file_bytes, sheet)
    plan = plan or {}
    errors = validate_plan(df, variables, plan)
    if errors:
        raise ValueError("\n".join(errors))

    continuous, frequencies, other = summary_frames(describe_variables(df, variables, rules, exclude_out_of_range))

    if include_data:
        book = load_workbook(BytesIO(file_bytes))
        ws = book[sheet]
        columns, codebook, _ = build_coding(df, plan, rules, exclude_out_of_range)
        # pandas의 i번째 행 = 엑셀 i+2행 (1행은 머리글)
        for name, values in columns.items():
            col = ws.max_column + 1
            ws.cell(row=1, column=col, value=name)
            for i, value in enumerate(values):
                ws.cell(row=i + 2, column=col, value=value)
        if codebook:
            write_frame(book, CODEBOOK_SHEET, pd.DataFrame(codebook))
    else:
        book = Workbook()
        book.remove(book.active)

    if not continuous.empty:
        write_frame(book, CONTINUOUS_SHEET, continuous)
    if not frequencies.empty:
        write_frame(book, FREQUENCY_SHEET, frequencies)
    if not other.empty:
        write_frame(book, OTHER_SHEET, other)
    if not book.sheetnames:
        raise ValueError("요약할 변수를 선택하세요.")

    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()

ANALYSIS_SHEET = "Analysis_Data"


def export_analysis(file_bytes, sheet, codebook):
    errors = validate_codebook(codebook)
    if not codebook:
        errors.append("코드를 입력한 범주형 변수가 없습니다.")
    if sheet == ANALYSIS_SHEET:
        errors.append("원본 데이터 시트를 선택하세요.")
    if errors:
        raise ValueError("\n".join(errors))

    df = read_sheet(file_bytes, sheet)
    columns = [str(column) for column in df.columns]
    book = load_workbook(BytesIO(file_bytes))
    if ANALYSIS_SHEET in book.sheetnames:
        del book[ANALYSIS_SHEET]
    ws = book.copy_worksheet(book[sheet])
    ws.title = ANALYSIS_SHEET

    rows = []
    for column, levels in codebook.items():
        col = columns.index(column) + 1
        for i, value in enumerate(apply_codebook(df[column], levels)):
            ws.cell(row=i + 2, column=col, value=None if pd.isna(value) else value)
        for level in sorted(levels, key=lambda item: float(item["code"])):
            rows.append({
                "Variable": column,
                "Code": plain_number(level["code"]),
                "Label": level["label"],
                "Source_Values": ", ".join(level["sources"]),
            })
    write_frame(book, CODEBOOK_SHEET, pd.DataFrame(rows))

    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def r_text(text):
    escaped = str(text).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{escaped}"'


def build_r_script(file_name, codebook):
    lines = [
        "# 엑셀 파일과 같은 폴더에서 실행하세요.",
        '# Windows: source("이_파일.R", encoding = "UTF-8")',
        "library(readxl)",
        f'df <- read_excel({r_text(file_name)}, sheet = "{ANALYSIS_SHEET}")',
        "",
    ]
    for column, levels in codebook.items():
        levels = sorted(levels, key=lambda item: float(item["code"]))
        codes = ", ".join(str(plain_number(level["code"])) for level in levels)
        labels = ", ".join(r_text(level["label"]) for level in levels)
        name = "df$`" + column.replace("`", "\\`") + "`"
        lines.append(f"{name} <- factor({name}, levels = c({codes}), labels = c({labels}))")
    return "\n".join(lines) + "\n"
