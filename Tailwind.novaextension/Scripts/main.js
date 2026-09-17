'use strict'

const { CompletionProvider } = require('./completion-provider.js')

const SUPPORTED_SYNTAXES = [
  'html', 'html+erb', 'html+eex', 'haml', 'php', 'blade', 'twig', 'liquid-html',
  'jade', 'pug', 'markdown', 'vue', 'svelte', 'astro',
  'javascript', 'typescript', 'jsx', 'tsx',
  'css', 'sass', 'scss',
]

// Tailwind class tokens lean heavily on characters most syntaxes don't treat as part of an
// "identifier" (e.g. `top-0`, `hover:`, `bg-blue-500/50`, `@md:`). Without listing them as
// trigger characters, Nova dismisses the completion popup the moment one is typed and won't
// ask any provider again until the next identifier character — visible as completions
// vanishing on `-` and reappearing on the following digit/letter.
const TRIGGER_CHARS = new Charset('-:/.@')

let disposable = null

exports.activate = function () {
  disposable = nova.assistants.registerCompletionAssistant(SUPPORTED_SYNTAXES, new CompletionProvider(), {
    triggerChars: TRIGGER_CHARS,
  })
}

exports.deactivate = function () {
  if (disposable) {
    disposable.dispose()
    disposable = null
  }
}
