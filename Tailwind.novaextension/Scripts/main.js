'use strict'

const { CompletionProvider } = require('./completion-provider.js')
const { ThemeCoordinator } = require('./theme-coordinator.js')
const { SidebarDataProvider } = require('./sidebar-provider.js')
const { ColorAssistant } = require('./color-assistant.js')
const { findClassLists, findClassListAt, sortablePart, tidyWhitespace } = require('./class-sort.js')
const lspInstaller = require('./lsp-installer.js')
const { TailwindLanguageClient } = require('./lsp-client.js')
const { debug } = require('./lsp-debug.js')

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

const ENABLE_HOVER_PREVIEW_KEY = 'garrill.tailwind.enableHoverPreview'
const ENABLE_LINTING_KEY = 'garrill.tailwind.enableLinting'
const THEME_ENTRY_PATH_KEY = 'garrill.tailwind.themeEntryPath'
const NODE_MISSING_NOTIFICATION_ID = 'garrill.tailwind.nodeMissing'

let disposable = null
let colorDisposable = null
let themeCoordinator = null
let sidebarSubscriptions = []
let langClient = null
let serverFeatures = { hovers: false, lint: false }
let nodeMissingNotified = false
let serverConfigSubscriptions = []

exports.activate = function () {
  const provider = new CompletionProvider()
  disposable = nova.assistants.registerCompletionAssistant(SUPPORTED_SYNTAXES, provider, {
    triggerChars: TRIGGER_CHARS,
  })

  const colorAssistant = new ColorAssistant()
  colorDisposable = nova.assistants.registerColorAssistant(SUPPORTED_SYNTAXES, colorAssistant)

  const sidebarProvider = new SidebarDataProvider()
  const treeView = new TreeView('garrill.tailwind.documentation', { dataProvider: sidebarProvider })
  sidebarProvider.attachTreeView(treeView)
  sidebarSubscriptions.push(treeView)
  sidebarSubscriptions.push(
    nova.commands.register('garrill.tailwind.sidebar.filter', () => sidebarProvider.promptFilter())
  )
  sidebarSubscriptions.push(
    nova.commands.register('garrill.tailwind.sidebar.clearFilter', () => sidebarProvider.clearFilter())
  )
  sidebarSubscriptions.push(
    nova.commands.register('garrill.tailwind.sidebar.expandAll', () => sidebarProvider.setForceExpanded(true))
  )
  sidebarSubscriptions.push(
    nova.commands.register('garrill.tailwind.sidebar.collapseAll', () => sidebarProvider.setForceExpanded(false))
  )
  sidebarSubscriptions.push(
    nova.commands.register('garrill.tailwind.sidebar.insertClass', () => sidebarProvider.insertSelectedClass())
  )
  sidebarSubscriptions.push(
    nova.commands.register('garrill.tailwind.sidebar.openDocs', () => sidebarProvider.openSelectedDocs())
  )
  sidebarSubscriptions.push(
    nova.commands.register('garrill.tailwind.sidebar.copyClassName', () => sidebarProvider.copySelectedClassName())
  )
  sidebarSubscriptions.push(
    nova.commands.register('garrill.tailwind.sidebar.copyCss', () => sidebarProvider.copySelectedCss())
  )

  sidebarSubscriptions.push(
    nova.commands.register('garrill.tailwind.sortClasses', (target) => sortClasses(target))
  )
  sidebarSubscriptions.push(
    nova.commands.register('garrill.tailwind.sortAllClasses', (target) => sortAllClasses(target))
  )

  // Scans the project's configured @theme/@utility CSS (if any) and keeps the completion
  // provider, the sidebar's dataset and the color swatches in sync with it — see
  // Scripts/theme-coordinator.js.
  themeCoordinator = new ThemeCoordinator([provider, sidebarProvider, colorAssistant])
  themeCoordinator.start()

  // Hover preview and linting: installs/runs Tailwind's own language server on demand while
  // either is on — both on by default, turned off per project via workspace settings — see
  // Scripts/lsp-client.js.
  // The settings are declared in configWorkspace (Project → Project Settings), so a value set
  // in the global Extensions preferences is never read — log both to make that mismatch visible.
  debug(`activate(): nova version=${nova.versionString}, workspace=${nova.workspace.path}`)
  for (const key of [ENABLE_HOVER_PREVIEW_KEY, ENABLE_LINTING_KEY]) {
    debug(`activate(): ${key} project=${nova.workspace.config.get(key, 'boolean')}` +
      ` global=${nova.config.get(key, 'boolean')}`)
  }

  langClient = new TailwindLanguageClient(SUPPORTED_SYNTAXES)
  for (const key of [ENABLE_HOVER_PREVIEW_KEY, ENABLE_LINTING_KEY]) {
    serverConfigSubscriptions.push(
      nova.workspace.config.observe(key, (value) => {
        debug(`${key} observed as ${value}`)
        syncLanguageServer()
      }, this)
    )
  }
  serverConfigSubscriptions.push(
    nova.workspace.config.observe(THEME_ENTRY_PATH_KEY, () => langClient.updateConfig(), this)
  )
}

// Only an explicit `false` turns a feature off — an unset value (null) means the default, on.
function readServerFeatures() {
  return {
    hovers: nova.workspace.config.get(ENABLE_HOVER_PREVIEW_KEY, 'boolean') !== false,
    lint: nova.workspace.config.get(ENABLE_LINTING_KEY, 'boolean') !== false,
  }
}

// Installs (if needed) and starts/restarts/stops the language client to match the current
// settings. Never throws: a failed install/start just logs and leaves hover/linting
// unavailable, matching theme-coordinator.js's "log and fall back" convention — except a
// missing Node.js/npm, which the user can actually fix, so that also shows a notification.
function syncLanguageServer() {
  serverFeatures = readServerFeatures()
  if (!serverFeatures.hovers && !serverFeatures.lint) {
    nova.notifications.cancel(NODE_MISSING_NOTIFICATION_ID)
    langClient.stop()
    return
  }

  // Each step is async: both settings may have been turned off, or the extension
  // deactivated, before it finished.
  const stillWanted = () => !!langClient && (serverFeatures.hovers || serverFeatures.lint)
  const onError = (err) => {
    console.error('[Tailwind] hover preview/linting unavailable:', err.message)
    if (err.nodeMissing && stillWanted()) showNodeMissingNotification()
  }

  lspInstaller.checkNode((err) => {
    if (err) return onError(err)
    if (!stillWanted()) return
    lspInstaller.installOrUpdate(false, (err) => {
      if (err) return onError(err)
      if (!stillWanted()) {
        debug('install finished but hover preview/linting is no longer enabled, not starting client')
        return
      }
      debug('install check passed, starting client with', JSON.stringify(serverFeatures))
      // Restarts an already-running client if the features changed.
      langClient.start(serverFeatures)
    })
  })
}

const SORT_REQUEST = '@/tailwindCSS/sortSelection'
const TEMPLATE_CODE_SKIPPED = 'only the classes before any template code ({{ }}, ${ }, <?php …) are sorted.'

// Both sort commands are invoked from the Editor menu (gets the editor) or the Command
// Palette (gets the workspace), so fall back to the active editor.
function targetEditor(target) {
  return TextEditor.isTextEditor(target) ? target : nova.workspace.activeTextEditor
}

/*
  "Tailwind: Sort Classes": sorts each selection — or, for an empty selection, the class list
  around the cursor (see class-sort.js#findClassListAt) — into Tailwind's recommended order.
*/
function sortClasses(target) {
  const editor = targetEditor(target)
  if (!editor) return

  const ranges = []
  for (const selection of editor.selectedRanges) {
    if (!selection.empty) {
      ranges.push(selection)
      continue
    }
    const lineRange = editor.getLineRangeForRange(selection)
    const found = findClassListAt(editor.getTextInRange(lineRange), selection.start - lineRange.start)
    if (!found) continue
    ranges.push(new Range(lineRange.start + found.start, lineRange.start + found.end))
  }

  if (ranges.length === 0) {
    nova.workspace.showInformativeMessage('Tailwind: put the cursor inside a class attribute or @apply, or select the classes to sort.')
    return
  }
  return sortRanges(editor, withoutOverlaps(ranges), `Tailwind: nothing to sort — ${TEMPLATE_CODE_SKIPPED}`)
}

// Several cursors in one list, or a selection inside a list another cursor also found, would
// otherwise replace the same text twice. Keeps the widest of any overlapping ranges.
function withoutOverlaps(ranges) {
  const kept = []
  const widestFirst = ranges.slice().sort((a, b) => (b.end - b.start) - (a.end - a.start))
  for (const range of widestFirst) {
    if (!kept.some((k) => range.start < k.end && k.start < range.end)) kept.push(range)
  }
  return kept
}

/*
  "Tailwind: Sort All Classes in Document": sorts every class attribute/key value and `@apply`
  statement in the document (see class-sort.js#findClassLists), as one undoable edit.
*/
function sortAllClasses(target) {
  const editor = targetEditor(target)
  if (!editor) return

  const found = findClassLists(editor.getTextInRange(new Range(0, editor.document.length)))
  if (found.length === 0) {
    nova.workspace.showInformativeMessage('Tailwind: no class attributes or @apply statements found in this document.')
    return
  }
  const ranges = found.map(({ start, end }) => new Range(start, end))
  return sortRanges(editor, ranges, `Tailwind: nothing to sort — ${TEMPLATE_CODE_SKIPPED}`)
}

/*
  Shared by both commands: sends the sortable ranges' text to the language server in one
  request and writes back the lists whose order changed, with tidied whitespace, in a single
  edit.
*/
async function sortRanges(editor, ranges, nothingSortableMessage) {
  // Each list is cut short at its first template code (class-sort.js#sortablePart), which
  // stays where it is after the sorted classes.
  const lists = []
  for (const range of ranges) {
    const text = editor.getTextInRange(range)
    const part = sortablePart(text)
    if (!part) continue
    lists.push({
      range: new Range(range.start, range.start + part.end),
      text: text.slice(0, part.end),
      separator: part.separator,
    })
  }
  if (lists.length === 0) {
    nova.workspace.showInformativeMessage(nothingSortableMessage)
    return
  }

  if (!langClient || !langClient.running) {
    nova.workspace.showInformativeMessage('Tailwind: sorting classes uses Tailwind\'s language server, which runs ' +
      'while hover preview or linting is enabled (Project → Project Settings → Tailwind) and Node.js is installed.')
    return
  }

  // The ranges are offsets into the document as it is now; if it changes while the server
  // replies, they'd point at the wrong text.
  const documentBefore = editor.getTextInRange(new Range(0, editor.document.length))

  let result
  try {
    result = await langClient.sendRequest(SORT_REQUEST, {
      uri: editor.document.uri,
      classLists: lists.map(({ text }) => text),
    })
  } catch (err) {
    console.error('[Tailwind] sorting classes failed:', err)
    nova.workspace.showInformativeMessage(`Tailwind: sorting classes failed (${err.message || err}).`)
    return
  }
  if (!result || result.error || !Array.isArray(result.classLists)) {
    const reason = result && result.error === 'no-project'
      ? 'no Tailwind project was found for this file'
      : `the language server couldn't sort them (${(result && result.error) || 'no reply'})`
    nova.workspace.showInformativeMessage(`Tailwind: couldn't sort classes — ${reason}.`)
    return
  }

  // Only touch lists whose order changed — tidying their whitespace (double spaces, leading/
  // trailing space) while at it — and replace from the end of the document backwards so
  // earlier edits can't shift later ranges.
  const replacements = lists
    .map(({ range, text, separator }, i) => ({ range, text, separator, sorted: result.classLists[i] }))
    .filter(({ text, sorted }) => typeof sorted === 'string' && sorted !== text)
    // With template code after the list, the separator replaces the list's trailing whitespace.
    .map(({ range, sorted, separator }) => ({
      range,
      sorted: tidyWhitespace(separator ? sorted.trimEnd() : sorted) + separator,
    }))
    .sort((a, b) => b.range.start - a.range.start)
  if (replacements.length === 0) return
  if (editor.document.isClosed ||
      editor.getTextInRange(new Range(0, editor.document.length)) !== documentBefore) {
    nova.workspace.showInformativeMessage('Tailwind: the document changed while sorting, so nothing was changed. Try again.')
    return
  }
  editor.edit((edit) => {
    for (const { range, sorted } of replacements) edit.replace(range, sorted)
  })
}

// Shown at most once per activation, so re-toggling the setting doesn't stack them up.
function showNodeMissingNotification() {
  if (nodeMissingNotified) return
  nodeMissingNotified = true

  const request = new NotificationRequest(NODE_MISSING_NOTIFICATION_ID)
  request.title = 'Tailwind hover preview and linting need Node.js'
  request.body = 'Hover previews and linting use Tailwind\'s language server, which requires Node.js. Completions and the sidebar work without it.'
  request.actions = ['Turn Off for This Project', 'Dismiss']

  nova.notifications.add(request).then((response) => {
    if (response.actionIdx !== 0) return
    nova.workspace.config.set(ENABLE_HOVER_PREVIEW_KEY, false)
    nova.workspace.config.set(ENABLE_LINTING_KEY, false)
  }, (err) => debug(`node-missing notification closed without an action: ${err}`))
}

exports.deactivate = function () {
  if (disposable) {
    disposable.dispose()
    disposable = null
  }
  if (colorDisposable) {
    colorDisposable.dispose()
    colorDisposable = null
  }
  if (themeCoordinator) {
    themeCoordinator.dispose()
    themeCoordinator = null
  }
  for (const subscription of sidebarSubscriptions) subscription.dispose()
  sidebarSubscriptions = []
  for (const subscription of serverConfigSubscriptions) subscription.dispose()
  serverConfigSubscriptions = []
  if (langClient) {
    langClient.stop()
    langClient = null
  }
  serverFeatures = { hovers: false, lint: false }
  nova.notifications.cancel(NODE_MISSING_NOTIFICATION_ID)
}
