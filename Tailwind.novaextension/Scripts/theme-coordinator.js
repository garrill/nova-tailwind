'use strict'

/*
  Owns the async lifecycle for custom theme support: reads the configured entry CSS file path,
  loads it (and its local @imports) via theme-loader.js, parses it via theme-scanner.js, merges
  it over the default theme via theme-merge.js, and pushes the result into every registered
  provider (CompletionProvider, SidebarDataProvider, ...) via its rebuild() method. Also wires up
  rescanning on save (primary) and on external file changes (defensive fallback) — see CLAUDE.md's
  "Custom theme support" section.

  Never lets a scan failure break completions: any error at any stage falls back to
  `rebuild()` with no argument (defaults only) on every provider, logged via
  console.warn/console.error (visible in Extensions → Show Extension Console).
*/

const defaultTheme = require('./data/theme.generated.js')
const { loadThemeSources } = require('./theme-loader.js')
const { scanCss } = require('./theme-scanner.js')
const { mergeTheme } = require('./theme-merge.js')

const CONFIG_KEY = 'garrill.tailwind.themeEntryPath'
const SUPPRESS_DEFAULT_COLORS_KEY = 'garrill.tailwind.suppressDefaultColors'
const RESCAN_DEBOUNCE_MS = 200

// Runs theme-scanner.js#scanCss() over each source file in order (Map insertion order, which
// theme-loader.js arranges to approximate real CSS cascade order — imports before the
// importing file), concatenating results with a single, file-spanning declaration order so
// theme-merge.js's clear-then-redefine logic works across file boundaries too.
function scanAllSources(filesByPath) {
  const themeDeclarations = []
  const utilityNames = []
  let orderOffset = 0

  for (const content of filesByPath.values()) {
    const result = scanCss(content)
    for (const decl of result.themeDeclarations) {
      themeDeclarations.push({ ...decl, order: decl.order + orderOffset })
    }
    utilityNames.push(...result.utilityNames)
    orderOffset += result.themeDeclarations.length
  }

  return { themeDeclarations, utilityNames }
}

exports.ThemeCoordinator = class ThemeCoordinator {
  // `provider` may be a single provider (CompletionProvider) or an array of providers that
  // both implement `rebuild(theme)` (e.g. also SidebarDataProvider) — every rescan calls
  // rebuild() on all of them so completions and the sidebar stay in sync with the same theme.
  constructor(provider) {
    this._providers = Array.isArray(provider) ? provider : [provider]
    this._disposables = []
    this._watchedPaths = new Set()
    this._fsWatcher = null
    this._watchedEntryPath = null
    this._rescanTimer = null
  }

  start() {
    // observe() fires immediately with the current value, then again on every change — this
    // covers both "initial load at activation" and "user edited the setting", for either
    // config key (both require a full rescan/rebuild to take effect).
    this._disposables.push(
      nova.workspace.config.observe(CONFIG_KEY, () => this.rescan(), this)
    )
    this._disposables.push(
      nova.workspace.config.observe(SUPPRESS_DEFAULT_COLORS_KEY, () => this.rescan(), this)
    )

    this._disposables.push(
      nova.workspace.onDidAddTextEditor((editor) => {
        const editorDisposable = editor.onDidSave((savedEditor) => {
          if (this._watchedPaths.has(savedEditor.document.path)) this._scheduleRescan()
        })
        this._disposables.push(editorDisposable)
      })
    )
  }

  dispose() {
    for (const disposable of this._disposables) disposable.dispose()
    this._disposables = []
    if (this._fsWatcher) this._fsWatcher.dispose()
    if (this._rescanTimer) clearTimeout(this._rescanTimer)
  }

  _scheduleRescan() {
    // Both the save listener and the fs.watch fallback can fire for the same edit — debounce
    // so a single edit doesn't trigger the (cheap, idempotent) rebuild twice in a row.
    if (this._rescanTimer) clearTimeout(this._rescanTimer)
    this._rescanTimer = setTimeout(() => this.rescan(), RESCAN_DEBOUNCE_MS)
  }

  _rebuildAll(theme) {
    for (const provider of this._providers) provider.rebuild(theme)
  }

  rescan() {
    try {
      const entryPath = nova.workspace.config.get(CONFIG_KEY, 'string')
      if (!entryPath) {
        // No custom theme configured — normal default-only mode, not an error.
        this._watchedPaths = new Set()
        this._teardownFsWatch()
        this._rebuildAll()
        return
      }

      const sources = loadThemeSources(nova.workspace.path, entryPath)
      if (!sources) {
        console.warn(`[Tailwind] configured theme entry file not found: ${entryPath}`)
        this._watchedPaths = new Set()
        this._teardownFsWatch()
        this._rebuildAll()
        return
      }

      const suppressDefaultColors = nova.workspace.config.get(SUPPRESS_DEFAULT_COLORS_KEY, 'boolean')
      const scanResult = scanAllSources(sources.files)
      const merged = mergeTheme(defaultTheme, scanResult, { suppressDefaultColors })
      this._rebuildAll(merged)

      this._watchedPaths = new Set(sources.files.keys())
      this._setupFsWatch(sources.entryAbsolutePath)
    } catch (err) {
      console.error('[Tailwind] theme scan failed, falling back to default theme:', err)
      this._rebuildAll()
    }
  }

  // Watches only the entry file itself (not every transitively-imported partial) as a
  // defensive fallback for external edits the editor-save listener above can't see (git
  // checkout, another tool, an edit made while the file isn't open in Nova) — see
  // CLAUDE.md for why this is scoped to the entry file only.
  _setupFsWatch(entryAbsolutePath) {
    if (this._watchedEntryPath === entryAbsolutePath) return
    this._teardownFsWatch()
    // nova.fs.watch's pattern is resolved relative to the workspace root, not an absolute path.
    const relativePattern = nova.path.relative
      ? nova.path.relative(nova.workspace.path, entryAbsolutePath)
      : entryAbsolutePath
    this._fsWatcher = nova.fs.watch(relativePattern, () => this._scheduleRescan())
    this._watchedEntryPath = entryAbsolutePath
  }

  _teardownFsWatch() {
    if (this._fsWatcher) {
      this._fsWatcher.dispose()
      this._fsWatcher = null
    }
    this._watchedEntryPath = null
  }
}
