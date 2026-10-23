// 엑셀 셀 주소(G5 등)와 화면 표 위치 사이 변환. 주소 규칙은 backend/src/validator.py의 get_cell과 같다.

// 표 안의 위치. row는 table.rows의 순번(엑셀 행 번호 - 2), col은 컬럼 순번
export interface CellPos {
  row: number
  col: number
}

export function columnLetter(index: number) {
  let n = index + 1
  let letters = ''
  while (n > 0) {
    const rest = (n - 1) % 26
    letters = String.fromCharCode(65 + rest) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

export const cellAddress = ({ row, col }: CellPos) => `${columnLetter(col)}${row + 2}`

export function parseCell(address: string): CellPos {
  const [, letters, digits] = /^([A-Z]+)(\d+)$/.exec(address) ?? ['', 'A', '2']
  const col = [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
  return { row: Number(digits) - 2, col }
}
