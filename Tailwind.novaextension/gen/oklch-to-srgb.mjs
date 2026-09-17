'use strict'

// Converts a CSS `oklch(L% C H)` color to sRGB, using the standard OKLab/OKLCH
// matrices from the CSS Color 4 spec (https://www.w3.org/TR/css-color-4/#color-conversion-code).
// Vendored here (instead of an npm dependency) since this is a small, one-time, well-defined
// piece of math run only by the offline generator script.

function oklchToOklab(L, C, H) {
  const hRad = (H * Math.PI) / 180
  return [L, C * Math.cos(hRad), C * Math.sin(hRad)]
}

function oklabToLinearSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b

  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]
}

function linearToGammaSrgb(c) {
  const abs = Math.abs(c)
  if (abs > 0.0031308) {
    return (c < 0 ? -1 : 1) * (1.055 * Math.pow(abs, 1 / 2.4) - 0.055)
  }
  return c * 12.92
}

function clamp255(n) {
  return Math.min(255, Math.max(0, Math.round(n * 255)))
}

/**
 * @param {number} L Lightness, 0-1 (i.e. already divided from the `%` in the CSS value)
 * @param {number} C Chroma, as written in the CSS value (unitless, typically 0-0.4)
 * @param {number} H Hue, in degrees
 * @returns {[number, number, number]} sRGB channel values, 0-255
 */
export function oklchToSrgb255(L, C, H) {
  const [oL, oa, ob] = oklchToOklab(L, C, H)
  const [lr, lg, lb] = oklabToLinearSrgb(oL, oa, ob)
  return [
    clamp255(linearToGammaSrgb(lr)),
    clamp255(linearToGammaSrgb(lg)),
    clamp255(linearToGammaSrgb(lb)),
  ]
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
}
