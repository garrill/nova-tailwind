'use strict'

/*
  Color swatches for Tailwind color classes (`bg-red-500`, `hover:text-sky-600/50`, a custom
  `@theme` color, …) via Nova's color-assistant API. Built here rather than on the language
  server's `textDocument/documentColor`, because Nova's LanguageClient doesn't support that
  request — see CLAUDE.md's "Color swatches". Works without Node.js as a result.

  The class → hex lookup comes from completion-provider.js#buildCompletionData(), so custom
  themes and `suppressDefaultColors` apply here exactly as they do to completions;
  rebuild(theme) duck-types CompletionProvider#rebuild so ThemeCoordinator keeps it in sync.
*/

const { buildCompletionData } = require('./completion-provider.js')
const { hexToColor } = require('./color.js')

const ENABLE_COLOR_SWATCHES_KEY = 'garrill.tailwind.enableColorSwatches'

// Candidate class tokens: runs of characters that can appear in a class, split on anything
// that can't (whitespace, quotes, markup/CSS punctuation).
const TOKEN = /[^\s"'`<>=;{},]+/g

// Index of the first character after the variant prefix (`md:hover:`), ignoring `:` inside
// arbitrary `[...]`/`(...)` values.
function baseStart(token) {
  let depth = 0
  let start = 0
  for (let i = 0; i < token.length; i++) {
    const ch = token[i]
    if (ch === '[' || ch === '(') depth++
    else if ((ch === ']' || ch === ')') && depth > 0) depth--
    else if (ch === ':' && depth === 0) start = i + 1
  }
  return start
}

// `50` → 0.5, `[0.5]` → 0.5, `[50%]` → 0.5; anything else (e.g. `(--my-opacity)`) → 1.
function parseOpacity(modifier) {
  if (modifier === undefined) return 1
  const arbitrary = /^\[([\d.]+)(%?)\]$/.exec(modifier)
  if (arbitrary) return clamp(parseFloat(arbitrary[1]) / (arbitrary[2] ? 100 : 1))
  if (/^[\d.]+$/.test(modifier)) return clamp(parseFloat(modifier) / 100)
  return 1
}

function clamp(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1
}

/*
  Pure scan (no nova.* calls): every color class in `text` whose base (after variants and an
  `!` important flag, before an `/opacity` modifier) is a key of `colorsByClass` (class → hex).
  Returns `[{ start, end, hex, alpha }]`, where start/end cover the base class only.
*/
function findColorTokens(text, colorsByClass) {
  const found = []
  TOKEN.lastIndex = 0
  let match
  while ((match = TOKEN.exec(text)) !== null) {
    const token = match[0]
    let start = baseStart(token)
    let end = token.length
    if (token[start] === '!') start++ // v3-style leading important flag
    if (token[end - 1] === '!') end-- // v4-style trailing important flag

    const base = token.slice(start, end)
    const slash = base.indexOf('/')
    const name = slash < 0 ? base : base.slice(0, slash)
    const hex = colorsByClass.get(name)
    if (!hex) continue

    const tokenStart = match.index + start
    found.push({
      start: tokenStart,
      end: tokenStart + name.length,
      hex,
      alpha: parseOpacity(slash < 0 ? undefined : base.slice(slash + 1)),
    })
  }
  return found
}

function buildColorMap(theme) {
  const map = new Map()
  for (const entry of buildCompletionData(theme)) {
    if (entry.color) map.set(entry.label, entry.color)
  }
  return map
}

exports.ColorAssistant = class ColorAssistant {
  constructor() {
    this._colorsByClass = buildColorMap()
  }

  // Called by theme-coordinator.js after a (re)scan of the project's theme CSS; no argument
  // means the default theme.
  rebuild(theme) {
    this._colorsByClass = buildColorMap(theme)
  }

  provideColors(editor) {
    // Only an explicit `false` turns swatches off — an unset value means the default, on.
    if (nova.workspace.config.get(ENABLE_COLOR_SWATCHES_KEY, 'boolean') === false) return []

    const text = editor.getTextInRange(new Range(0, editor.document.length))
    return findColorTokens(text, this._colorsByClass).map(({ start, end, hex, alpha }) =>
      new ColorInformation(new Range(start, end), hexToColor(hex, alpha)))
  }

  // Swatches are read-only: a color picked in Nova's picker has no meaningful palette class to
  // write back, so no presentations are offered.
  provideColorPresentations() {
    return []
  }
}

exports.findColorTokens = findColorTokens
