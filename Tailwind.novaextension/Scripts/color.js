'use strict'

/*
  Converts the hex strings in Scripts/data/theme.generated.js into Nova `Color` objects
  for use as a CompletionItem's swatch (`item.color`, shown when `item.kind` is
  `CompletionItemKind.Color`). The heavy lifting (OKLCH → sRGB) already happened offline
  in gen/generate-theme.mjs — this is just hex → Nova's Color('rgb', [r, g, b]) (0-1 range).
*/

function hexToRgb01(hex) {
  const normalized = hex.replace('#', '')
  const full = normalized.length === 3
    ? normalized.split('').map((c) => c + c).join('')
    : normalized

  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255

  return [r, g, b]
}

// `alpha` (0–1) is used by color-assistant.js for opacity modifiers like `bg-red-500/50`.
exports.hexToColor = function hexToColor(hex, alpha = 1) {
  return new Color('rgb', [...hexToRgb01(hex), alpha])
}
