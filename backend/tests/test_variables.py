from io import BytesIO
from pathlib import Path
import sys

import pandas as pd
import pytest
from openpyxl import Workbook, load_workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from variables import (  # noqa: E402
    apply_codebook,
    build_r_script,
    describe_workbook,
    export_analysis,
    export_variables,
    validate_codebook,
)


def workbook():
    book = Workbook()
    sheet = book.active
    sheet.title = "Data"
    rows = [("ID", "Age", "Sex", "Visit_Date"), ("001", 30, "M", "2026-01-05"), ("002", 40, "F", "2026-02-01"),
            ("003", 64.5, "M", "2026-13-01"), ("004", 65, " M", None), ("005", "17O", "F", "2026-03-10"),
            ("006", None, None, "2026-01-20"), ("001", 80, "M", "2026-02-15")]
    for row in rows:
        sheet.append(row)
    book.create_sheet("Other")["A1"] = "unchanged"
    output = BytesIO()
    book.save(output)
    return output.getvalue()


VARIABLES = {"Age": "continuous", "Sex": "categorical"}
PLAN = {
    "bins": [{"column": "Age", "new_column": "Age_grp", "cuts": [40, 65], "codes": [1, 2, 3], "right_closed": False}],
    "codes": [{"column": "Sex", "new_column": "Sex_code", "mapping": {"M": 1, "F": 2}}],
}


def test_describe_continuous_matches_pandas_and_excludes_non_numbers():
    age, sex = describe_workbook(workbook(), "Data", VARIABLES)
    numbers = pd.Series([30, 40, 64.5, 65, 80], dtype=float)

    assert (age["n"], age["missing"], age["valid"], age["invalid"]) == (7, 1, 5, 1)
    assert age["invalid_examples"] == ["17O"]
    assert age["mean"] == pytest.approx(numbers.mean())
    assert age["median"] == 64.5
    assert age["skewness"] == pytest.approx(numbers.skew())
    assert age["kurtosis"] == pytest.approx(numbers.kurt())

    # 앞뒤 공백이 있는 값은 다른 값으로 센다 (표기 문제가 보이도록)
    assert [(lv["value"], lv["count"]) for lv in sex["levels"]] == [(" M", 1), ("F", 2), ("M", 3)]
    assert sex["missing"] == 1


def test_export_adds_coded_columns_codebook_and_keeps_other_sheets():
    book = load_workbook(BytesIO(export_variables(workbook(), "Data", VARIABLES, PLAN)))
    ws = book["Data"]
    header = [cell.value for cell in ws[1]]
    assert header == ["ID", "Age", "Sex", "Visit_Date", "Age_grp", "Sex_code"]

    age_grp = [ws.cell(row=r, column=5).value for r in range(2, 9)]
    sex_code = [ws.cell(row=r, column=6).value for r in range(2, 9)]
    # 40 이상 65 미만 = 2, 65 이상 = 3, 숫자가 아닌 값·결측은 빈칸
    assert age_grp == [1, 2, 2, 3, None, None, 3]
    # 코드를 정하지 않은 " M"은 빈칸
    assert sex_code == [1, 2, 1, None, 2, None, 1]

    assert book["Other"]["A1"].value == "unchanged"
    codebook = [[c.value for c in row] for row in book["Codebook"].iter_rows(min_row=2)]
    assert ["Age_grp", "Age", "구간", 2, "40 이상 65 미만"] in codebook
    assert ["Sex_code", "Sex", "범주 코드", 2, "F"] in codebook
    assert {"Continuous_Summary", "Frequencies"} <= set(book.sheetnames)


def test_right_closed_bins():
    plan = {"bins": [{**PLAN["bins"][0], "right_closed": True}]}
    ws = load_workbook(BytesIO(export_variables(workbook(), "Data", VARIABLES, plan)))["Data"]
    assert [ws.cell(row=r, column=5).value for r in range(2, 9)] == [1, 1, 2, 2, None, None, 3]


def test_describe_date_and_identifier():
    date, ident = describe_workbook(workbook(), "Data", {"Visit_Date": "date", "ID": "identifier"})
    assert (date["first"], date["last"], date["invalid"], date["missing"]) == ("2026-01-05", "2026-03-10", 1, 1)
    assert date["invalid_examples"] == ["2026-13-01"]
    assert (ident["unique"], ident["repeated"], ident["max_rows"]) == (6, 1, 2)
    assert ident["repeated_examples"] == [{"value": "001", "count": 2}]


def test_inspect_suggests_variable_types():
    from inspector import inspect_workbook
    suggested = {c["column"]: c["suggested"] for c in inspect_workbook(workbook(), "Data")["columns"]}
    assert suggested == {"ID": "identifier", "Age": "continuous", "Sex": "categorical", "Visit_Date": "date"}


RULES = {"numeric_columns": {"Age": {"min": 18, "max": 70}}, "date_columns": {"Visit_Date": {"min": "2026-01-10"}}}


def test_rule_ranges_are_counted_and_optionally_excluded():
    age, date = describe_workbook(workbook(), "Data", {"Age": "continuous", "Visit_Date": "date"}, RULES)
    assert (age["out_of_range"], age["out_of_range_examples"], age["excluded"], age["valid"]) == (1, [80], False, 5)
    assert (date["out_of_range"], date["out_of_range_examples"]) == (1, ["2026-01-05"])

    age, _ = describe_workbook(workbook(), "Data", {"Age": "continuous", "Visit_Date": "date"}, RULES, True)
    assert (age["excluded"], age["valid"], age["max"]) == (True, 4, 65)

    # 범위 밖 값을 뺐으면 구간 코드도 빈칸
    ws = load_workbook(BytesIO(export_variables(workbook(), "Data", VARIABLES, PLAN, True, RULES, True)))["Data"]
    assert [ws.cell(row=r, column=5).value for r in range(2, 9)] == [1, 2, 2, 3, None, None, None]


def test_summary_only_export():
    book = load_workbook(BytesIO(export_variables(workbook(), "Data", VARIABLES, PLAN, include_data=False)))
    assert book.sheetnames == ["Continuous_Summary", "Frequencies"]


@pytest.mark.parametrize("plan, message", [
    ({"bins": [{**PLAN["bins"][0], "cuts": [65, 40]}]}, "작은 값부터"),
    ({"bins": [{**PLAN["bins"][0], "codes": [1, 2]}]}, "숫자 코드"),
    ({"bins": [{**PLAN["bins"][0], "new_column": "Sex"}]}, "이미 있습니다"),
    ({"codes": [{**PLAN["codes"][0], "mapping": {"M": "남"}}]}, "숫자가 아닌 코드"),
])
def test_invalid_plan_is_rejected(plan, message):
    with pytest.raises(ValueError, match=message):
        export_variables(workbook(), "Data", VARIABLES, plan)


CODEBOOK = {
    "Sex": [
        {"code": 1, "label": "남", "sources": ["M", " M"]},
        {"code": 0, "label": "여", "sources": ["F"]},
    ],
}


def test_apply_codebook_keeps_unknown_values():
    series = pd.Series(["M", " M", "F", "X", None], dtype=object)

    result = apply_codebook(series, CODEBOOK["Sex"]).tolist()

    assert result[:4] == [1, 1, 0, "X"]  # X는 스크리닝에서 잡히도록 남는다
    assert result[4] is None


def test_export_analysis_adds_coded_sheet_and_keeps_raw():
    book = load_workbook(BytesIO(export_analysis(workbook(), "Data", CODEBOOK)))

    assert book.sheetnames == ["Data", "Other", "Analysis_Data", "Codebook"]
    assert [row[0].value for row in book["Data"]["C2:C8"]] == ["M", "F", "M", " M", "F", None, "M"]
    assert [row[0].value for row in book["Analysis_Data"]["C2:C8"]] == [1, 0, 1, 1, 0, None, 1]
    assert list(book["Codebook"].values)[1:] == [("Sex", 0, "여", "F"), ("Sex", 1, "남", "M,  M")]


def test_export_analysis_can_run_again_on_its_output():
    first = export_analysis(workbook(), "Data", CODEBOOK)
    book = load_workbook(BytesIO(export_analysis(first, "Data", CODEBOOK)))

    assert book.sheetnames.count("Analysis_Data") == 1
    assert book.sheetnames.count("Codebook") == 1


def test_r_script_sorts_levels_by_code_and_escapes_labels():
    codebook = {"Sex": [
        {"code": 1, "label": '남"성', "sources": ["M"]},
        {"code": 0, "label": "여", "sources": ["F"]},
    ]}

    script = build_r_script("data_analysis.xlsx", codebook)

    assert 'read_excel("data_analysis.xlsx", sheet = "Analysis_Data")' in script
    assert 'df$`Sex` <- factor(df$`Sex`, levels = c(0, 1), labels = c("여", "남\\"성"))' in script


@pytest.mark.parametrize("levels, message", [
    ([{"code": "남", "label": "남", "sources": ["M"]}], "숫자"),
    ([{"code": 1, "label": "", "sources": ["M"]}], "라벨"),
    ([{"code": 1, "label": "남", "sources": []}], "원본 값"),
    ([{"code": 1, "label": "남", "sources": ["M"]}, {"code": 1, "label": "여", "sources": ["F"]}], "중복"),
    ([{"code": 1, "label": "남", "sources": ["M"]}, {"code": 0, "label": "여", "sources": ["M"]}], "두 코드"),
])
def test_invalid_codebook_is_rejected(levels, message):
    assert any(message in error for error in validate_codebook({"Sex": levels}))
