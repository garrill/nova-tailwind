'use strict'

/*
  Extracts Tailwind v4 `@theme { --token: value; }` declarations and `@utility name { ... }`
  class names from a project's own CSS, so completion-provider.js can merge them over the
  generated default theme (see theme-merge.js).

  This is a single-pass, brace-depth-tracking, dependency-free tokenizer — extending
  gen/generate-theme.mjs's regex/buffering approach (which only has to cope with Tailwind's own
  simple, non-nested published theme.css) with real depth tracking, since a project's own
  `@utility` bodies can contain arbitrary nested CSS (media queries, `&:hover`, etc.) that must
  not derail parsing. There is no npm CSS parser available here — Nova loads Scripts/ directly
  via require() with no build step, so this has to stay dependency-free like the rest of the
  runtime code.

  Known, documented simplifications (v1 scope):
  - `@theme inline` / `@theme static` modifiers are parsed identically to plain `@theme` — they
    affect how Tailwind's own generated CSS emits var() references, not the resolved value we
    show in completions.
  - Only @theme/@utility blocks at the top level of a file are recognized (matches how Tailwind
    v4 actually expects them to be authored).
  - Comments are stripped with a simple regex, not a real tokenizer — a `/*`-like sequence
    inside a quoted string (extremely unlikely in a Tailwind theme file) could misparse.
  - Functional utilities (`@utility tab-* { ... }`) are recognized and skipped, not surfaced as
    completions — parsing their `--value()`/`--modifier()` internals is out of scope for v1.
*/

const THEME_BLOCK_START = /^@theme(?:\s+(?:inline|static))?\s*\{/
const UTILITY_BLOCK_START = /^@utility\s+([a-zA-Z0-9_-]+\*?)\s*\{/

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function dedupeOrdered(items) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

// Skips a quoted string starting at `css[startIndex]` (which must be a quote character),
// returning the index just past its closing quote (or the end of the string if unterminated).
function skipString(css, startIndex) {
  const quote = css[startIndex]
  let j = startIndex + 1
  while (j < css.length) {
    if (css[j] === '\\') {
      j += 2
      continue
    }
    if (css[j] === quote) return j + 1
    j++
  }
  return css.length
}

// `css[openBraceIndex]` must be '{'. Returns the block's inner content and the index of its
// matching '}', tracking nested braces (and skipping quoted strings, so a stray '{'/'}' inside
// a string doesn't desync the count). Never throws on an unterminated block — falls back to EOF.
function readBalancedBlock(css, openBraceIndex) {
  let depth = 0
  let j = openBraceIndex
  while (j < css.length) {
    const ch = css[j]
    if (ch === '"' || ch === "'") {
      j = skipString(css, j)
      continue
    }
    if (ch === '{') {
      depth++
      j++
      continue
    }
    if (ch === '}') {
      depth--
      if (depth === 0) return { body: css.slice(openBraceIndex + 1, j), endIndex: j }
      j++
      continue
    }
    j++
  }
  return { body: css.slice(openBraceIndex + 1), endIndex: css.length }
}

// Splits an @theme block body into `;`-terminated statements, quote-aware (so a `;` inside a
// quoted string value doesn't split mid-value) and newline-agnostic — unlike
// gen/generate-theme.mjs's line-based joiner, this also handles a whole `@theme { ... }` block
// written on a single line (e.g. compact/minified project CSS), not just Tailwind's own
// published theme.css, which always puts one declaration per line.
function splitStatements(text) {
  const statements = []
  let buffer = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"' || ch === "'") {
      const end = skipString(text, i)
      buffer += text.slice(i, end)
      i = end
      continue
    }
    if (ch === ';') {
      statements.push(buffer)
      buffer = ''
      i++
      continue
    }
    buffer += ch
    i++
  }
  if (buffer.trim() !== '') statements.push(buffer)
  return statements
}

// Parses `--token: value;` declarations inside an @theme block body.
function scanThemeBody(body, declarations, orderCounter) {
  for (const statement of splitStatements(body)) {
    const decl = statement.trim()
    if (decl === '' || !decl.startsWith('--')) continue
    const colonIndex = decl.indexOf(':')
    if (colonIndex === -1) continue
    const name = decl.slice(0, colonIndex).trim()
    const value = decl.slice(colonIndex + 1).trim()
    declarations.push({ name, value, order: orderCounter++ })
  }
  return orderCounter
}

/*
  Returns:
  {
    themeDeclarations: [{ name: '--color-red-500', value: '#ff0000' | 'initial', order }],
    utilityNames: ['btn', 'card', ...],
    skippedFunctionalUtilities: ['tab-*', ...],
  }
  Never throws — on any unexpected input it returns whatever was successfully collected before
  the failure, so a scan failure can never break completions (see theme-coordinator.js).
*/
function scanCss(cssText) {
  const themeDeclarations = []
  const utilityNames = []
  const skippedFunctionalUtilities = []

  try {
    const css = stripComments(cssText)
    const n = css.length
    let i = 0
    let depth = 0
    let orderCounter = 0

    while (i < n) {
      const ch = css[i]

      if (ch === '"' || ch === "'") {
        i = skipString(css, i)
        continue
      }

      if (depth === 0 && ch === '@') {
        const rest = css.slice(i)

        const themeMatch = THEME_BLOCK_START.exec(rest)
        if (themeMatch) {
          const openBrace = i + themeMatch[0].length - 1
          const { body, endIndex } = readBalancedBlock(css, openBrace)
          orderCounter = scanThemeBody(body, themeDeclarations, orderCounter)
          i = endIndex + 1
          continue
        }

        const utilityMatch = UTILITY_BLOCK_START.exec(rest)
        if (utilityMatch) {
          const name = utilityMatch[1]
          const openBrace = i + utilityMatch[0].length - 1
          const { endIndex } = readBalancedBlock(css, openBrace)
          if (name.endsWith('-*')) {
            skippedFunctionalUtilities.push(name)
          } else {
            utilityNames.push(name)
          }
          i = endIndex + 1
          continue
        }
      }

      if (ch === '{') {
        depth++
        i++
        continue
      }
      if (ch === '}') {
        depth = Math.max(0, depth - 1)
        i++
        continue
      }

      i++
    }
  } catch (err) {
    console.error('[Tailwind] theme-scanner: failed to fully parse CSS, using partial results:', err)
  }

  return {
    themeDeclarations,
    utilityNames: dedupeOrdered(utilityNames),
    skippedFunctionalUtilities: dedupeOrdered(skippedFunctionalUtilities),
  }
}

/*
  Classifies a parsed `--token: value` declaration by which theme.generated.js-shaped namespace
  it belongs to, mirroring gen/generate-theme.mjs's own prefix matching. Returns null for custom
  properties this extension doesn't model in completions (font families, shadows, etc. — same
  scope-out as the generator).

  `key === '*'` marks a namespace-wide reset (`--color-*: initial;`); `isInitial` with a
  non-`*` key marks a single token being reverted (`--color-red-500: initial;`).
*/
function classifyDeclaration(name, value) {
  const isInitial = value.trim() === 'initial'

  if (name === '--spacing') return { namespace: 'spacing', key: null, value, isInitial }

  if (name.startsWith('--color-')) {
    return { namespace: 'colors', key: name.slice('--color-'.length), value, isInitial }
  }
  if (name.startsWith('--breakpoint-')) {
    return { namespace: 'breakpoints', key: name.slice('--breakpoint-'.length), value, isInitial }
  }
  if (name.startsWith('--container-')) {
    return { namespace: 'containerSizes', key: name.slice('--container-'.length), value, isInitial }
  }
  if (name.startsWith('--text-shadow-')) return null // not modeled — same scope-out as the generator
  if (name.startsWith('--text-') && name.endsWith('--line-height')) {
    return { namespace: 'lineHeight', key: name.slice('--text-'.length, -'--line-height'.length), value, isInitial }
  }
  if (name.startsWith('--text-')) {
    return { namespace: 'fontSize', key: name.slice('--text-'.length), value, isInitial }
  }
  if (name.startsWith('--font-weight-')) {
    return { namespace: 'fontWeight', key: name.slice('--font-weight-'.length), value, isInitial }
  }
  if (name.startsWith('--tracking-')) {
    return { namespace: 'letterSpacing', key: name.slice('--tracking-'.length), value, isInitial }
  }
  if (name.startsWith('--radius-')) {
    return { namespace: 'borderRadius', key: name.slice('--radius-'.length), value, isInitial }
  }
  if (name.startsWith('--blur-')) {
    return { namespace: 'blur', key: name.slice('--blur-'.length), value, isInitial }
  }

  return null
}

exports.scanCss = scanCss
exports.classifyDeclaration = classifyDeclaration
