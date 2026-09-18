'use strict'

const { CompletionProvider } = require('./completion-provider.js')
const { ThemeCoordinator } = require('./theme-coordinator.js')
const { SidebarDataProvider } = require('./sidebar-provider.js')

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
let themeCoordinator = null
let sidebarSubscriptions = []

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
}
