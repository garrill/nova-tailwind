#!/usr/bin/env node
'use strict'

// Regenerates Scripts/data/theme.generated.js from the `tailwindcss` package's own
// published `theme.css`, which is a flat list of `@theme { --token: value; }` custom
// properties. This is the canonical, versioned source of truth for the default
// palette/scale data — instead of hand-transcribing docs (which is what the old
// tailwindcss-nova-ext extension did, and why it went stale).
//
// Usage:
//   cd gen && npm install && npm run generate
//
// To pick up a new Tailwind release, bump the `tailwindcss` version in gen/package.json
// and rerun. This script only touches Scripts/data/theme.generated.js — the utility
// name/pattern tables in Scripts/data/utilities.js and Scripts/data/variants.js are
// hand-maintained separately, since Tailwind doesn't publish those as data.

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { oklchToSrgb255, rgbToHex } from './oklch-to-srgb.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const themeCssPath = require.resolve('tailwindcss/theme.css')
const themeCss = readFileSync(themeCssPath, 'utf8')
const tailwindVersion = require('tailwindcss/package.json').version

// Only the first `@theme default { ... }` block matters — the second block further down
// is a deprecated-aliases block we don't need for completions.
const firstBlockMatch = themeCss.match(/@theme[^{]*\{([\s\S]*?)\n\}/)
if (!firstBlockMatch) {
  throw new Error('Could not find a @theme block in theme.css — has the file format changed?')
}
const body = firstBlockMatch[1]

// Strip @keyframes blocks (they contain nested `{ }` which would confuse the flat
// property parser below, and we don't need animation keyframes for completions).
const bodyWithoutKeyframes = body.replace(/@keyframes\s+[a-zA-Z-]+\s*\{[\s\S]*?\n {2}\}/g, '')

// Parse `--token: value;` declarations. Some values span multiple lines (font stacks,
// multi-shadow lists) — join continuation lines until we hit the terminating `;`.
const declarations = []
{
  let buffer = ''
  for (const rawLine of bodyWithoutKeyframes.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    buffer += (buffer ? ' ' : '') + line
    if (buffer.endsWith(';')) {
      const decl = buffer.slice(0, -1)
      const colonIndex = decl.indexOf(':')
      if (colonIndex !== -1 && decl.startsWith('--')) {
        const name = decl.slice(0, colonIndex).trim()
        const value = decl.slice(colonIndex + 1).trim()
        declarations.push([name, value])
      }
      buffer = ''
    }
  }
}

const colors = {}
const spacing = {}
const breakpoints = {}
const containerSizes = {}
const fontSize = {}
const fontWeight = {}
const letterSpacing = {}
const lineHeight = {}
const borderRadius = {}
const blur = {}

const oklchPattern = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+(none|[\d.]+)\s*\)$/

for (const [name, value] of declarations) {
  if (name.startsWith('--color-')) {
    const key = name.slice('--color-'.length)
    if (value.startsWith('#')) {
      colors[key] = value
      continue
    }
    const match = value.match(oklchPattern)
    if (match) {
      const L = parseFloat(match[1]) / 100
      const C = parseFloat(match[2])
      const H = match[3] === 'none' ? 0 : parseFloat(match[3])
      colors[key] = rgbToHex(oklchToSrgb255(L, C, H))
    }
    continue
  }

  if (name === '--spacing') {
    spacing.base = value
    continue
  }

  if (name.startsWith('--breakpoint-')) {
    breakpoints[name.slice('--breakpoint-'.length)] = value
    continue
  }

  if (name.startsWith('--container-')) {
    containerSizes[name.slice('--container-'.length)] = value
    continue
  }

  if (name.startsWith('--text-shadow-')) {
    // Not a font-size scale; ignore for v1 (text-shadow utilities aren't in the completion set yet).
    continue
  }

  if (name.startsWith('--text-') && name.endsWith('--line-height')) {
    lineHeight[name.slice('--text-'.length, -'--line-height'.length)] = value
    continue
  }

  if (name.startsWith('--text-')) {
    fontSize[name.slice('--text-'.length)] = value
    continue
  }

  if (name.startsWith('--font-weight-')) {
    fontWeight[name.slice('--font-weight-'.length)] = value
    continue
  }

  if (name.startsWith('--tracking-')) {
    letterSpacing[name.slice('--tracking-'.length)] = value
    continue
  }

  if (name.startsWith('--radius-')) {
    borderRadius[name.slice('--radius-'.length)] = value
    continue
  }

  if (name.startsWith('--blur-')) {
    blur[name.slice('--blur-'.length)] = value
    continue
  }
}

const output = `'use strict'

/*
  GENERATED FILE — do not hand-edit.

  Produced by gen/generate-theme.mjs from tailwindcss@${tailwindVersion}'s published theme.css.
  Regenerate with: cd gen && npm install && npm run generate
*/

module.exports = {
  tailwindVersion: ${JSON.stringify(tailwindVersion)},
  colors: ${JSON.stringify(colors, null, 2)},
  spacing: ${JSON.stringify(spacing, null, 2)},
  breakpoints: ${JSON.stringify(breakpoints, null, 2)},
  containerSizes: ${JSON.stringify(containerSizes, null, 2)},
  fontSize: ${JSON.stringify(fontSize, null, 2)},
  lineHeight: ${JSON.stringify(lineHeight, null, 2)},
  fontWeight: ${JSON.stringify(fontWeight, null, 2)},
  letterSpacing: ${JSON.stringify(letterSpacing, null, 2)},
  borderRadius: ${JSON.stringify(borderRadius, null, 2)},
  blur: ${JSON.stringify(blur, null, 2)},
}
`

const outPath = join(__dirname, '..', 'Scripts', 'data', 'theme.generated.js')
writeFileSync(outPath, output)
console.log(`Wrote ${outPath} from tailwindcss@${tailwindVersion} (${Object.keys(colors).length} color scales)`)
