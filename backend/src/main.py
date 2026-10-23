
from pathlib import Path
import argparse
import json

from screening import RulesError, run_screening


BASE_DIR = Path(__file__).resolve().parents[2]

SEVERITY_ORDER = {"ERROR": 0, "REVIEW": 1, "INFO": 2}


def print_issues(issues, show_info=False, limit=50):
    if issues.empty:
        print("발견된 문제가 없습니다.")
        return

    targets = issues if show_info else issues[issues["Severity"] != "INFO"]
    hidden_info = len(issues) - len(targets)

    targets = targets.sort_values(
        by=["Severity", "Excel_Row"],
        key=lambda s: s.map(SEVERITY_ORDER) if s.name == "Severity" else s
    )

    for _, issue in targets.head(limit).iterrows():
        value = f" 값='{issue['Original_Value']}'" if issue["Original_Value"] else ""
        print(
            f"[{issue['Severity']}] {issue['Cell']} "
            f"({issue['Column']}, {issue['Excel_Row']}행) "
            f"{issue['Issue_Type']}{value} - {issue['Description']}"
        )

    if len(targets) > limit:
        print(f"... 외 {len(targets) - limit}건은 결과 파일에서 확인하세요.")

    if hidden_info:
        print(f"(INFO {hidden_info}건 생략, --show-info 옵션으로 표시)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_file")
    parser.add_argument("--rules", default=None)
    parser.add_argument("--show-info", action="store_true", help="INFO 등급(결측값 등)도 출력")
    parser.add_argument("--limit", type=int, default=50, help="터미널에 출력할 최대 건수")
    parser.add_argument("--sheet", default=None, help="검사할 시트 이름 (기본: 첫 번째 시트)")
    args = parser.parse_args()

    input_file = Path(args.input_file)

    if not input_file.exists():
        raise FileNotFoundError(input_file)

    rules = None

    if args.rules:
        with open(args.rules, "r", encoding="utf-8") as f:
            rules = json.load(f)

    try:
        result = run_screening(input_file.read_bytes(), rules, args.sheet)
    except RulesError as e:
        print("규칙 파일에 오류가 있어 검사를 실행하지 않았습니다.")
        for error in e.errors:
            print(f"  - {error}")
        raise SystemExit(1)

    output_dir = BASE_DIR / "output"
    output_dir.mkdir(exist_ok=True)

    output_file = output_dir / f"{input_file.stem}_screening.xlsx"
    output_file.write_bytes(result["report"])

    for warning in result["warnings"]:
        print(f"[경고] {warning}")

    issues = result["issues"]
    print_issues(issues, show_info=args.show_info, limit=args.limit)
    print()
    print(f"스크리닝 완료: {len(issues)}건")
    print(f"결과 파일: {output_file}")


if __name__ == "__main__":
    main()
