'use strict'

// Characters that can never appear inside a Tailwind class token, so they terminate it
// when scanning backward from the cursor.
const TOKEN_BOUNDARY = /[\s"'`<>=]/

/*
  Pulls the partial class token immediately before the cursor out of `context.line`
  (Nova gives us the line's text up to the cursor already, so this is just "scan
  backward to the nearest boundary character").
*/
function getCurrentToken(line) {
  let i = line.length
  while (i > 0 && !TOKEN_BOUNDARY.test(line[i - 1])) {
    i--
  }
  return line.slice(i)
}

/*
  Splits a token into `:`-separated variant segments, respecting `[...]`/`(...)` nesting
  so an arbitrary variant's own `:` (e.g. `[@media(min-width:900px)]`) doesn't get treated
  as a stacking separator.
*/
function splitVariantSegments(token) {
  const segments = []
  let current = ''
  let depth = 0

  for (const ch of token) {
    if (ch === '[' || ch === '(') depth++
    if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1)

    if (ch === ':' && depth === 0) {
      segments.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  segments.push(current)

  return { segments, endsInsideBrackets: depth > 0 }
}

/*
  @param {string} line - context.line: the text of the current line up to the cursor.
  @param {number} position - context.position: the cursor's absolute document offset.
  @returns {null | { bareSegment: string, isNegative: boolean, range: Range }}
    null means "don't offer completions here" (empty token, or cursor is inside an
    arbitrary `[...]`/`(...)` value, which v1 doesn't try to complete).
*/
exports.parse = function parse(line, position) {
  const token = getCurrentToken(line)
  if (token === '') return null

  const { segments, endsInsideBrackets } = splitVariantSegments(token)
  if (endsInsideBrackets) return null

  const lastSegment = segments[segments.length - 1]
  const isNegative = lastSegment.startsWith('-')
  const bareSegment = isNegative ? lastSegment.slice(1) : lastSegment

  return {
    bareSegment,
    isNegative,
    range: new Range(position - lastSegment.length, position),
  }
}
