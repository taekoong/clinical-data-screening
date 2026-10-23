export const ISSUE_LABELS: Record<string, string> = {
  EMPTY_COLUMN: '빈 컬럼',
  MISSING_VALUE: '결측값',
  EXTRA_WHITESPACE: '앞뒤 공백',
  SUSPECTED_TYPO: '숫자 컬럼의 문자',
  INVALID_NUMERIC_VALUE: '숫자 변환 불가',
  OUT_OF_RANGE: '허용 범위 밖',
  INVALID_CATEGORY: '허용되지 않는 값',
  CATEGORY_VARIANT: '표기 차이',
  INVALID_ID_FORMAT: 'ID 형식 오류',
  DUPLICATE_RECORD: '중복 레코드',
  INVALID_DATE: '날짜 변환 불가',
  DATE_OUT_OF_PERIOD: '연구 기간 밖',
  CROSS_CHECK_FAILED: '컬럼 간 조건 위반',
}

export const SEVERITY_LABELS = { ERROR: '오류', REVIEW: '확인 필요', INFO: '정보' } as const

export const issueLabel = (code: string) => ISSUE_LABELS[code] ?? code
