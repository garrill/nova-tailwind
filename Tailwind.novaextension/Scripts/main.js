'use strict'

const { CompletionProvider } = require('./completion-provider.js')
const { ThemeCoordinator } = require('./theme-coordinator.js')
const { SidebarDataProvider } = require('./sidebar-provider.js')
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

  // Scans the project's configured @theme/@utility CSS (if any) and keeps both the completion
  // provider and the sidebar's dataset in sync with it — see Scripts/theme-coordinator.js.
  themeCoordinator = new ThemeCoordinator([provider, sidebarProvider])
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
