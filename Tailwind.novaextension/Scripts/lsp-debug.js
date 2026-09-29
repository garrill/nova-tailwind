'use strict'

// Verbose hover-preview logging (Extensions → Show Extension Console). Flip to false once the
// language-server wiring is confirmed working.
const DEBUG = false

exports.DEBUG = DEBUG

exports.debug = function debug(...args) {
  if (DEBUG) console.log('[Tailwind][hover]', ...args)
}
