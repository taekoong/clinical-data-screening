// 문제가 되는 글자를 눈에 띄게 표시: 공백은 ·로, 숫자 컬럼의 문자(영문 O 등)는 강조
export default function ValueText({ value, numeric }: { value: string; numeric: boolean }) {
  if (value === '') return <span className="muted">(빈 값)</span>

  return (
    <>
      {[...value].map((char, i) => {
        if (char === ' ') return <mark key={i} className="mark-space" title="공백">·</mark>
        if (numeric && !/[0-9.+-]/.test(char)) return <mark key={i} title="숫자가 아닌 글자">{char}</mark>
        return char
      })}
    </>
  )
}
