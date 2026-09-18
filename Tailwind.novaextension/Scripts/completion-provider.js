'use strict'

const { parse } = require('./class-parser.js')
const { hexToColor } = require('./color.js')
const defaultTheme = require('./data/theme.generated.js')
const scales = require('./data/scales.js')
const { UTILITY_FAMILIES } = require('./data/utilities.js')
const { VARIANTS } = require('./data/variants.js')

// Strips floating-point noise (e.g. 0.1 + 0.2) and trailing zeros for display.
function trimNumber(n) {
  return parseFloat(n.toFixed(3)).toString()
}

// Tailwind's spacing utilities resolve to `calc(var(--spacing) * N)`, which is technically
// accurate but useless at a glance in a completion list. Resolve it against the theme's
// actual `--spacing` base (0.25rem by default, or a project's own custom value — see
// theme-merge.js) and show the concrete px value instead, e.g. `top-4` → "top: 16px (1rem);".
function formatSpacingValue(theme, rawStep, negative) {
  const remBase = parseFloat(theme.spacing.base) // theme.spacing.base is e.g. "0.25rem"
  const n = parseFloat(rawStep)
  const sign = negative ? '-' : ''
  const remValue = trimNumber(n * remBase)
  const pxValue = trimNumber(n * remBase * 16)
  return `${sign}${pxValue}px (${sign}${remValue}rem)`
}

// Converts a rem CSS length (e.g. "1.125rem") to "18px (1.125rem)", assuming the standard
// 16px root font size (Tailwind itself assumes this when generating its rem-based scales).
function remToPxRem(remString) {
  const rem = parseFloat(remString)
  return `${trimNumber(rem * 16)}px (${trimNumber(rem)}rem)`
}

// theme.generated.js stores line-height either as a bare unitless multiplier (e.g. "1", used
// for text-5xl and up) or as Tailwind's own `calc(lineHeightRem / fontSizeRem)` expression —
// in both cases the numerator (or the multiplier × font size) is the intended absolute
// line-height in rem, by construction of Tailwind's theme.css.
function resolveLineHeightRem(lineHeightRaw, fontSizeRem) {
  const calcMatch = lineHeightRaw.match(/^calc\(([\d.]+)\s*\/\s*[\d.]+\)$/)
  if (calcMatch) return parseFloat(calcMatch[1])
  return parseFloat(lineHeightRaw) * fontSizeRem
}

// `text-lg` → "font: 18px/156%;" — font-size in px, line-height as a percentage of the
// font-size (the same relationship the CSS `font` shorthand's size/line-height slot uses).
function formatFontSizeShorthand(fontSizeRem, lineHeightRem) {
  const px = trimNumber(fontSizeRem * 16)
  const percent = Math.round((lineHeightRem / fontSizeRem) * 100)
  return `font: ${px}px/${percent}%;`
}

// Scales published in theme.generated.js as rem lengths where the px equivalent is worth
// surfacing alongside it (border radii, container/max-width breakpoints).
const PX_REM_SCALES = new Set(['borderRadius', 'containerSizes'])

function negatedFormula(value) {
  // Value is a plain `Nunit` (e.g. "0.05em", "10deg") — negate the numeric literal in place.
  const plainMatch = value.match(/^(-?[\d.]+)([a-z%]*)$/)
  if (plainMatch) {
    return `-${plainMatch[1]}${plainMatch[2]}`
  }
  return `-1 * ${value}` // fallback: still valid-ish as documentation text, not inserted as CSS
}

/*
  Builds the flat, kind-agnostic completion dataset once at activation (and again whenever
  theme-coordinator.js rescans a project's custom @theme/@utility CSS). `theme` defaults to the
  generated Tailwind default theme; a caller can pass a theme-merge.js#mergeTheme() result to
  reflect a project's own customizations instead. Each entry:
  { label, detail, documentation, category, color, allowNegation, negatedDetail, familyId }
  `label` never includes a leading `-` — negation is applied at request time by
  class-parser.js detecting the `-` the user already typed. `familyId` (absent on variants and
  custom utilities) mirrors the pushed entry's source UTILITY_FAMILIES object's `id` — used by
  sidebar-data.js to regroup this same flat data back into families without re-deriving it.
*/
function buildCompletionData(theme = defaultTheme) {
  const data = []

  for (const variant of VARIANTS) {
    data.push({
      label: variant.label,
      detail: variant.doc,
      documentation: `Tailwind variant — stacks before a utility, e.g. \`${variant.label}:bg-blue-500\`.`,
      category: 'Variants',
      isVariant: true,
    })
  }

  for (const family of UTILITY_FAMILIES) {
    if (family.kind === 'static') {
      for (const entry of family.items) {
        data.push({ label: entry.label, detail: entry.css, category: family.category, familyId: family.id })
      }
      continue
    }

    if (family.kind === 'color') {
      for (const { prefix, props } of family.prefixes) {
        for (const [colorKey, hex] of Object.entries(theme.colors)) {
          // A custom `--color-*` value that couldn't be resolved to hex (see
          // theme-merge.js#resolveColorValue) is still shown, just without a swatch.
          const isResolvedColor = typeof hex === 'string' && hex.startsWith('#')
          data.push({
            label: `${prefix}-${colorKey}`,
            detail: `${props.join(', ')}: ${hex};`,
            category: family.category,
            color: isResolvedColor ? hex : undefined,
            familyId: family.id,
          })
        }
        for (const keyword of family.extraKeywords || []) {
          data.push({
            label: `${prefix}-${keyword}`,
            detail: `${props.join(', ')}: ${keyword};`,
            category: family.category,
            familyId: family.id,
          })
        }
      }
      continue
    }

    if (family.kind === 'scale') {
      for (const { prefix, props } of family.prefixes) {
        if (family.scale === 'spacing') {
          for (const step of scales.SPACING_STEPS) {
            const detail = `${props.join(', ')}: ${formatSpacingValue(theme, step)};`
            data.push({
              label: `${prefix}-${step}`,
              detail,
              category: family.category,
              allowNegation: family.negative && step !== '0',
              negatedDetail: family.negative ? `${props.join(', ')}: ${formatSpacingValue(theme, step, true)};` : undefined,
              familyId: family.id,
            })
          }
        } else if (family.scale === 'fontSize') {
          for (const [key, fontSizeRemStr] of Object.entries(theme.fontSize)) {
            const fontSizeRem = parseFloat(fontSizeRemStr)
            const lineHeightRem = resolveLineHeightRem(theme.lineHeight[key], fontSizeRem)
            const detail = formatFontSizeShorthand(fontSizeRem, lineHeightRem)
            data.push({ label: `${prefix}-${key}`, detail, category: family.category, familyId: family.id })
          }
        } else {
          const scaleMap = theme[family.scale] || {}
          const usesPxRem = PX_REM_SCALES.has(family.scale)
          for (const [key, value] of Object.entries(scaleMap)) {
            const displayValue = usesPxRem ? remToPxRem(value) : value
            const detail = `${props.join(', ')}: ${displayValue};`
            data.push({
              label: `${prefix}-${key}`,
              detail,
              category: family.category,
              allowNegation: family.negative,
              negatedDetail: family.negative ? `${props.join(', ')}: ${negatedFormula(value)};` : undefined,
              familyId: family.id,
            })
          }
        }
        for (const keyword of family.extraKeywords || []) {
          data.push({
            label: `${prefix}-${keyword.suffix}`,
            detail: `${props.join(', ')}: ${keyword.value};`,
            category: family.category,
            familyId: family.id,
          })
        }
      }
      continue
    }

    if (family.kind === 'numericList') {
      for (const { prefix, props } of family.prefixes) {
        for (const raw of family.values) {
          const value = `${raw}${family.unit || ''}`
          const detail = `${props.join(', ')}: ${value};`
          data.push({
            label: `${prefix}-${raw}`,
            detail,
            category: family.category,
            allowNegation: family.negative && raw !== '0',
            negatedDetail: family.negative ? `${props.join(', ')}: ${negatedFormula(value)};` : undefined,
            familyId: family.id,
          })
        }
      }
      continue
    }
  }

  // Custom `@utility name { ... }` classes discovered in a project's own theme CSS (see
  // theme-scanner.js/theme-merge.js) — present only when a rescan found some.
  for (const name of theme.customUtilities || []) {
    data.push({
      label: name,
      detail: `@utility ${name}`,
      documentation: `Custom utility defined in your project's theme CSS.`,
      category: 'Custom',
    })
  }

  return data
}

exports.buildCompletionData = buildCompletionData

exports.CompletionProvider = class CompletionProvider {
  constructor() {
    this._data = buildCompletionData()
  }

  // Called by theme-coordinator.js after a (re)scan of the project's theme CSS. Passing no
  // argument reverts to the default theme (e.g. on scan failure or an unset config path).
  rebuild(theme) {
    this._data = buildCompletionData(theme)
  }

  provideCompletionItems(editor, context) {
    if (!this._isEligibleContext(editor, context)) return null

    const parsed = parse(context.line, context.position)
    if (parsed === null) return null

    const { bareSegment, isNegative, range } = parsed

    const items = []
    for (const entry of this._data) {
      if (isNegative && !entry.allowNegation) continue
      if (bareSegment !== '' && !entry.label.startsWith(bareSegment)) continue

      const label = isNegative ? `-${entry.label}` : entry.label
      const item = new CompletionItem(label, entry.color ? CompletionItemKind.Color : (entry.isVariant ? CompletionItemKind.StylePseudoClass : CompletionItemKind.StyleClass))

      item.insertText = entry.isVariant ? `${label}:` : label
      item.range = range
      item.detail = isNegative && entry.negatedDetail ? entry.negatedDetail : entry.detail
      if (entry.documentation) item.documentation = entry.documentation
      if (entry.color) item.color = hexToColor(entry.color)

      items.push(item)
    }

    return items
  }

  _isEligibleContext(editor, context) {
    // Checked before anything selector-based: Nova's CSS grammar doesn't know what `@apply`
    // is, so `context.selectors` can come back empty (or not containing anything usefully
    // named) inside it — relying on selectors here would silently exclude `@apply` entirely.
    const syntax = editor && editor.document && editor.document.syntax
    if (syntax === 'css' || syntax === 'scss' || syntax === 'sass') {
      return this._isInsideApplyDirective(context.line)
    }

    if (context.selectors.length === 0) return false

    const matchesAny = (selectorString) => context.selectors.some((s) => s.matches(selectorString))

    if (matchesAny('tag.attribute.value')) return true
    if (matchesAny('string')) return true
    if (matchesAny('css') || matchesAny('scss')) return this._isInsideApplyDirective(context.line)

    return false
  }

  _isInsideApplyDirective(line) {
    // True once `@apply` has started on the current statement and hasn't been closed by a
    // `;` yet — covers `@apply flex p-4|` while still excluding unrelated CSS elsewhere on
    // the same line once a previous `@apply ...;` has already terminated.
    return /@apply\b[^;]*$/.test(line)
  }
}
