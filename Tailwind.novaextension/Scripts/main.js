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
const THEME_ENTRY_PATH_KEY = 'garrill.tailwind.themeEntryPath'
const NODE_MISSING_NOTIFICATION_ID = 'garrill.tailwind.nodeMissing'

let disposable = null
let themeCoordinator = null
let sidebarSubscriptions = []
let langClient = null
let hoverEnabled = false
let nodeMissingNotified = false
let hoverConfigSubscriptions = []

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

  // Hover preview: installs/runs Tailwind's own language server on demand, on by default and
  // turned off per project via a workspace setting — see Scripts/lsp-client.js.
  // The setting is declared in configWorkspace (Project → Project Settings), so a value set in
  // the global Extensions preferences is never read — log both to make that mismatch visible.
  debug(`activate(): nova version=${nova.versionString}, workspace=${nova.workspace.path}`)
  debug(`activate(): ${ENABLE_HOVER_PREVIEW_KEY} project=${nova.workspace.config.get(ENABLE_HOVER_PREVIEW_KEY, 'boolean')}` +
    ` global=${nova.config.get(ENABLE_HOVER_PREVIEW_KEY, 'boolean')}`)

  langClient = new TailwindLanguageClient(SUPPORTED_SYNTAXES)
  hoverConfigSubscriptions.push(
    nova.workspace.config.observe(ENABLE_HOVER_PREVIEW_KEY, (enabled) => {
      debug(`${ENABLE_HOVER_PREVIEW_KEY} observed as ${enabled}`)
      // Only an explicit `false` turns it off — an unset value (null) means the default, on.
      setHoverPreviewEnabled(enabled !== false)
    }, this)
  )
  hoverConfigSubscriptions.push(
    nova.workspace.config.observe(THEME_ENTRY_PATH_KEY, () => langClient.updateConfig(), this)
  )
}

// Installs (if needed) and starts/stops the hover-preview language client to match the
// current setting. Never throws: a failed install/start just logs and leaves hover
// unavailable, matching theme-coordinator.js's "log and fall back" convention — except a
// missing Node.js/npm, which the user can actually fix, so that also shows a notification.
function setHoverPreviewEnabled(enabled) {
  hoverEnabled = enabled
  if (!enabled) {
    nova.notifications.cancel(NODE_MISSING_NOTIFICATION_ID)
    langClient.stop()
    return
  }

  // Each step is async: the setting may have been turned off, or the extension deactivated,
  // before it finished.
  const stillWanted = () => !!langClient && hoverEnabled
  const onError = (err) => {
    console.error('[Tailwind] hover preview unavailable:', err.message)
    if (err.nodeMissing && stillWanted()) showNodeMissingNotification()
  }

  lspInstaller.checkNode((err) => {
    if (err) return onError(err)
    if (!stillWanted()) return
    lspInstaller.installOrUpdate(false, (err) => {
      if (err) return onError(err)
      if (!stillWanted()) {
        debug('install finished but hover preview is no longer enabled, not starting client')
        return
      }
      debug('install check passed, starting client')
      langClient.start()
    })
  })
}

// Shown at most once per activation, so re-toggling the setting doesn't stack them up.
function showNodeMissingNotification() {
  if (nodeMissingNotified) return
  nodeMissingNotified = true

  const request = new NotificationRequest(NODE_MISSING_NOTIFICATION_ID)
  request.title = 'Tailwind hover preview needs Node.js'
  request.body = 'Hovering a class to see its CSS uses Tailwind\'s language server, which requires Node.js. Completions and the sidebar work without it.'
  request.actions = ['Turn Off for This Project', 'Dismiss']

  nova.notifications.add(request).then((response) => {
    if (response.actionIdx === 0) nova.workspace.config.set(ENABLE_HOVER_PREVIEW_KEY, false)
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
  for (const subscription of hoverConfigSubscriptions) subscription.dispose()
  hoverConfigSubscriptions = []
  if (langClient) {
    langClient.stop()
    langClient = null
  }
  hoverEnabled = false
  nova.notifications.cancel(NODE_MISSING_NOTIFICATION_ID)
}
