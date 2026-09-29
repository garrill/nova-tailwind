'use strict'

// Verbose hover-preview logging (Extensions → Show Extension Console). Set to true when
// debugging the language-server wiring; keep false in releases.
const DEBUG = false

exports.DEBUG = DEBUG

exports.debug = function debug(...args) {
  if (DEBUG) console.log('[Tailwind][hover]', ...args)
}
