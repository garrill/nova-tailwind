'use strict'

/*
  Wraps Tailwind's own language server (@tailwindcss/language-server, installed by
  lsp-installer.js) via Nova's LanguageClient, for hover previews and linting (diagnostics plus
  their quick-fix code actions), each toggled by its own workspace setting.

  Diagnostics/hover/completions are all wired into Nova's UI automatically once a
  LanguageClient starts — Nova has no documented way to select a subset of LSP
  capabilities. Unwanted features are suppressed one layer down instead, via the server's own
  `tailwindCSS` settings (`suggestions: false` always, so this extension's CompletionProvider
  stays the only thing offering completions; `hovers`/`validate`/`codeActions` per the
  `features` passed to start()), and lsp-shim.js strips the matching capability claims so a
  disabled feature doesn't take hover/code actions away from another language server.

  The server isn't launched directly: lsp-shim.js sits in between, because run bare under
  Nova it (a) prints stray text into the LSP stream, which makes Nova drop every later
  message, and (b) never receives these settings — see that file's header comment.
*/

const { binPath } = require('./lsp-installer.js')
const { debug, DEBUG } = require('./lsp-debug.js')

const THEME_ENTRY_PATH_KEY = 'garrill.tailwind.themeEntryPath'
const STOP_TIMEOUT_MS = 5000

// Nova syntax name -> LSP languageId, only where they differ from the syntax name itself
// or aren't one of the server's natively-known template-language ids. Unknowns fall back
// to 'html', which is the closest approximation for class-bearing markup the server
// doesn't specifically recognize.
const LANGUAGE_ID_OVERRIDES = {
  jsx: 'javascriptreact',
  tsx: 'typescriptreact',
  'html+erb': 'erb',
  'html+eex': 'html', // no confirmed native EEx id — safe fallback, revisit if inaccurate
  'liquid-html': 'html', // no confirmed native Liquid id — safe fallback
  jade: 'jade',
  pug: 'jade', // Pug's LSP languageId is historically 'jade'
  astro: 'html', // no confirmed native Astro id — safe fallback
}

function languageIdFor(syntax) {
  return LANGUAGE_ID_OVERRIDES[syntax] || syntax
}

// The shim and server are launched as `/usr/bin/env node …`, so they only run if `node` is
// on the PATH Nova hands to child processes — which can differ from your shell's PATH.
function logNodeLocation() {
  try {
    const which = new Process('/usr/bin/env', { args: ['which', 'node'], shell: false })
    let found = ''
    which.onStdout((line) => { found += line })
    which.onDidExit((code) => debug(`\`which node\` → ${code === 0 ? found.trim() : `not found (exit ${code})`}`))
    which.start()
  } catch (err) {
    debug(`could not run \`which node\`: ${err}`)
  }
}

function resolveConfigFilePath() {
  const entryPath = nova.workspace.config.get(THEME_ENTRY_PATH_KEY, 'string')
  if (!entryPath) return undefined
  return nova.path.isAbsolute(entryPath) ? entryPath : nova.path.join(nova.workspace.path, entryPath)
}

exports.TailwindLanguageClient = class TailwindLanguageClient {
  constructor(syntaxes) {
    this._syntaxes = syntaxes
    this._client = null
    this._stopping = null // Promise that resolves once the previous client has fully shut down
    this._pendingStart = false
    this._features = { hovers: true, lint: false }
    this._startedWithSettings = null // JSON of the tailwindCSS settings the running client got
  }

  get running() {
    return !!this._client && this._client.running
  }

  // `features` is `{ hovers, lint }`; omitted, the last-given features are reused. If a client
  // is already running with different settings, it's restarted with the new ones.
  start(features) {
    if (features) this._features = features
    if (this._client) {
      this.updateConfig()
      return
    }

    // LanguageClient#stop() is async, and Nova rejects a new client with the same identifier
    // ("Another instance of … is already running") until the old one has actually exited —
    // so a quick off→on toggle, or updateConfig()'s restart, has to wait for it.
    if (this._stopping) {
      if (!this._pendingStart) {
        debug('start(): previous client still stopping, will start once it has')
        this._pendingStart = true
        this._stopping.then(() => {
          if (!this._pendingStart) return // stop() was called again in the meantime
          this._pendingStart = false
          this.start()
        })
      }
      return
    }

    const configFile = resolveConfigFilePath()
    const tailwindSettings = this._settings()
    this._startedWithSettings = JSON.stringify(tailwindSettings)

    const shimPath = nova.path.join(nova.extension.path, 'Scripts', 'lsp-shim.js')
    const serverOptions = {
      path: '/usr/bin/env',
      args: ['node', shimPath, binPath(), '--stdio'],
      env: {
        TAILWIND_LSP_SETTINGS: JSON.stringify(tailwindSettings),
        TAILWIND_LSP_DEBUG: DEBUG ? '1' : '0',
      },
    }

    const clientOptions = {
      debug: DEBUG, // Nova 10+: logs the client's raw LSP traffic to the extension console
      syntaxes: this._syntaxes.map((syntax) => ({ syntax, languageId: languageIdFor(syntax) })),
    }

    debug(`start(): server=${binPath()} exists=${!!nova.fs.stat(binPath())}, shim=${shimPath} exists=${!!nova.fs.stat(shimPath)}`)
    debug(`start(): workspace=${nova.workspace.path} configFile=${configFile || '(none — server auto-detects)'}` +
      (configFile ? ` exists=${!!nova.fs.stat(configFile)}` : ''))
    debug('start(): tailwindCSS settings =', JSON.stringify(tailwindSettings))
    if (DEBUG) logNodeLocation()

    const client = new LanguageClient('garrill.tailwind.lsp', 'Tailwind CSS', serverOptions, clientOptions)
    client.onDidStop((err) => {
      if (err) console.error('[Tailwind] language server stopped unexpectedly:', err)
      else debug('language server stopped (no error)')
    })

    try {
      client.start()
      nova.subscriptions.add(client)
      this._client = client
      debug('start(): client.start() called')
      // start() is async — check a few seconds later whether the server is actually still up.
      setTimeout(() => debug(`3s after start: client.running=${client.running}`), 3000)
    } catch (err) {
      console.error('[Tailwind] failed to start language server:', err)
    }
  }

  stop() {
    this._pendingStart = false
    if (!this._client) return
    debug('stop(): stopping client')

    const client = this._client
    this._client = null
    const stopping = new Promise((resolve) => {
      let settled = false
      const finish = (reason) => {
        if (settled) return
        settled = true
        debug(`previous client fully stopped (${reason})`)
        resolve()
      }
      const subscription = client.onDidStop(() => {
        subscription.dispose()
        finish('onDidStop')
      })
      // Don't wait forever if Nova never reports the stop (e.g. the server had already died).
      setTimeout(() => finish('timeout'), STOP_TIMEOUT_MS)
    })
    this._stopping = stopping
    stopping.then(() => {
      if (this._stopping === stopping) this._stopping = null
    })

    client.stop()
    nova.subscriptions.remove(client)
  }

  // Delivered to the server by lsp-shim.js via its `workspace/configuration` replies — the
  // server ignores `initializationOptions` for these.
  _settings() {
    const configFile = resolveConfigFilePath()
    return {
      hovers: this._features.hovers,
      suggestions: false,
      codeActions: this._features.lint,
      colorDecorators: false,
      validate: this._features.lint,
      ...(configFile ? { experimental: { configFile } } : {}),
    }
  }

  // Called when garrill.tailwind.themeEntryPath changes, or start() is called with different
  // features. The settings are handed to the shim at spawn time, so reflecting them means
  // restarting the client — same approach nova-typescript-lsp uses for its own config changes.
  // No-ops if the settings haven't actually changed (avoids restarting on unrelated churn).
  updateConfig() {
    if (!this._client) return
    if (JSON.stringify(this._settings()) === this._startedWithSettings) return
    debug('updateConfig(): settings changed, restarting client')
    this.stop()
    this.start()
  }
}
