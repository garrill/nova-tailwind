'use strict'

/*
  Merges parsed project `@theme`/`@utility` customizations (theme-scanner.js's scanCss() output)
  over the generated default theme (theme.generated.js) into a runtime theme object of the same
  shape, plus a `customUtilities` list. Pure and dependency-free — no `nova.*` calls — so it can
  be exercised outside Nova with plain fixture objects (see CLAUDE.md's Deno/Node stub-testing
  note).
*/

const { classifyDeclaration } = require('./theme-scanner.js')
const { oklchToSrgb255, rgbToHex } = require('./oklch-to-srgb.js')

const DICTIONARY_NAMESPACES = [
  'colors', 'breakpoints', 'containerSizes', 'fontSize', 'lineHeight',
  'fontWeight', 'letterSpacing', 'borderRadius', 'blur',
]

const OKLCH_PATTERN = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+(none|[\d.]+)\s*(?:\/\s*[\d.%]+\s*)?\)$/
const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const RGB_PATTERN = /^rgba?\(\s*([\d.]+)\s*,?\s*([\d.]+)\s*,?\s*([\d.]+)\s*(?:[,/]\s*[\d.%]+\s*)?\)$/

// Resolves a custom `--color-*` value to a hex string for use as a completion-item swatch.
// Returns null if the value can't be resolved (e.g. `var(--other-token)`, a named CSS color,
// an unsupported color function) — the caller keeps the raw value as display text and simply
// omits the swatch rather than dropping the completion entry.
function resolveColorValue(rawValue) {
  const value = rawValue.trim()

  if (HEX_PATTERN.test(value)) return value

  const oklchMatch = value.match(OKLCH_PATTERN)
  if (oklchMatch) {
    const L = parseFloat(oklchMatch[1]) / 100
    const C = parseFloat(oklchMatch[2])
    const H = oklchMatch[3] === 'none' ? 0 : parseFloat(oklchMatch[3])
    return rgbToHex(oklchToSrgb255(L, C, H))
  }

  const rgbMatch = value.match(RGB_PATTERN)
  if (rgbMatch) {
    const channels = [rgbMatch[1], rgbMatch[2], rgbMatch[3]].map((n) =>
      Math.max(0, Math.min(255, Math.round(parseFloat(n))))
    )
    return rgbToHex(channels)
  }

  return null
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

/*
  scanResult: { themeDeclarations: [{name, value, order}], utilityNames: [...] }
  (theme-scanner.js#scanCss()'s output, optionally concatenated across several files —
  concatenate the `themeDeclarations`/`utilityNames` arrays in file/import order first, since
  cross-file ordering matters for clear-then-redefine the same way in-file ordering does.)

  options.suppressDefaultColors: when true, the `colors` namespace starts empty instead of a
  copy of defaultTheme.colors — a blanket "only my own colors" toggle, equivalent to writing
  `--color-*: initial;` in the project's own @theme block without having to actually write it.
  Scoped to colors only (per the feature request) — other namespaces are unaffected.

  Never mutates `defaultTheme` — always builds fresh copies to merge into.
*/
function mergeTheme(defaultTheme, scanResult, options = {}) {
  const merged = {
    tailwindVersion: defaultTheme.tailwindVersion,
    spacing: { base: defaultTheme.spacing.base },
  }
  for (const namespace of DICTIONARY_NAMESPACES) {
    const suppressed = namespace === 'colors' && options.suppressDefaultColors
    merged[namespace] = suppressed ? {} : { ...(defaultTheme[namespace] || {}) }
  }

  const declarations = [...scanResult.themeDeclarations].sort((a, b) => a.order - b.order)

  for (const decl of declarations) {
    const classified = classifyDeclaration(decl.name, decl.value)
    if (!classified) continue // unrecognized custom property — not modeled in completions

    if (classified.namespace === 'spacing') {
      // `--spacing` is a scalar, not a family — `initial` just reverts it, no clear-then-
      // rebuild set semantics needed (unlike the dictionary namespaces below).
      merged.spacing.base = classified.isInitial ? defaultTheme.spacing.base : classified.value
      continue
    }

    const bucket = merged[classified.namespace]
    if (!bucket) continue // classifyDeclaration returned a namespace we don't track a bucket for

    if (classified.key === '*' && classified.isInitial) {
      // `--color-*: initial;` etc. — wipe everything accumulated so far in this namespace
      // (defaults *and* any earlier customizations), matching CSS's last-one-wins cascade
      // applied per-property-name, generalized to the wildcard token Tailwind defines it with.
      for (const key of Object.keys(bucket)) delete bucket[key]
      continue
    }

    if (classified.isInitial) {
      delete bucket[classified.key] // revert this one token to "not defined"
      continue
    }

    const value = classified.namespace === 'colors'
      ? (resolveColorValue(classified.value) || classified.value)
      : classified.value
    bucket[classified.key] = value
  }

  merged.customUtilities = dedupeOrdered(scanResult.utilityNames)
  return merged
}

exports.mergeTheme = mergeTheme
exports.resolveColorValue = resolveColorValue
