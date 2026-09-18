'use strict'

/*
  Nova TreeDataProvider for the Tailwind reference sidebar (extension.json's "sidebars" entry).
  Wraps Scripts/sidebar-data.js's pure tree/property-index/filter functions with the nova.*
  bits: TreeItem construction, filter/expand-all UI state, and wiring double-click insertion.

  rebuild(theme) duck-types CompletionProvider#rebuild(theme) (Scripts/completion-provider.js)
  so theme-coordinator.js can call both providers identically after a project theme rescan —
  see the ThemeCoordinator constructor's multi-provider support in theme-coordinator.js.
*/

const { UTILITY_FAMILIES } = require('./data/utilities.js')
const { buildSidebarTree, buildPropertyIndex, filterTree } = require('./sidebar-data.js')
const { hexToColor } = require('./color.js')
const { insertClass } = require('./insert-class-command.js')

// Property-name -> family/prefix index depends only on UTILITY_FAMILIES (not on a project's
// theme), so it's built once and reused across rebuild()s rather than recomputed per rescan.
const PROPERTY_INDEX = buildPropertyIndex(UTILITY_FAMILIES)

// Nova's bundled `__symbol.*` icons (originally for code-outline sidebars) double nicely as
// semantic icons here without needing any custom image assets — a node with neither `image` nor
// `color` set otherwise falls back to Nova's generic placeholder glyph.
const NODE_IMAGES = {
  category: '__symbol.category',
  family: '__symbol.property',
  class: '__symbol.style-class',
  variant: '__symbol.style-pseudoclass',
}

exports.SidebarDataProvider = class SidebarDataProvider {
  constructor() {
    this._roots = []
    this._nodesById = new Map()
    this._treeView = null
    this._filterQuery = ''
    this._filter = null // { visible: Set<identifier>, matched: Set<identifier> } | null
    this._forceExpanded = null // null = each node's natural default; true/false = force all

    this.rebuild()
  }

  attachTreeView(treeView) {
    this._treeView = treeView
  }

  // Called at construction (defaults only) and by theme-coordinator.js after every rescan of a
  // project's custom @theme/@utility CSS — same contract as CompletionProvider#rebuild(theme).
  rebuild(theme) {
    const { roots, nodesById } = buildSidebarTree(theme)
    this._roots = roots
    this._nodesById = nodesById
    this._applyFilter()
    if (this._treeView) this._treeView.reload()
  }

  _applyFilter() {
    this._filter = this._filterQuery
      ? filterTree(this._nodesById, PROPERTY_INDEX, this._filterQuery)
      : null
  }

  promptFilter() {
    nova.workspace.showInputPalette(
      'Filter Tailwind classes by name or CSS property',
      { placeholder: 'e.g. padding, or letter-spacing', value: this._filterQuery },
      (result) => {
        if (result === null) return // user cancelled
        if (result === '') {
          this.clearFilter()
          return
        }
        this._filterQuery = result
        this._applyFilter()
        if (this._treeView) this._treeView.reload()
      }
    )
  }

  clearFilter() {
    if (!this._filterQuery) return
    this._filterQuery = ''
    this._filter = null
    if (this._treeView) this._treeView.reload()
  }

  setForceExpanded(value) {
    this._forceExpanded = value
    if (this._treeView) this._treeView.reload()
  }

  insertSelectedClass() {
    const node = this._selectedNode()
    if (!node || !node.insertText) return
    insertClass(node.insertText)
  }

  openSelectedDocs() {
    const node = this._selectedNode()
    if (!node || !node.docUrl) return
    nova.openURL(node.docUrl)
  }

  copySelectedClassName() {
    const node = this._selectedNode()
    if (!node || !node.name) return
    nova.clipboard.writeText(node.name)
  }

  copySelectedCss() {
    const node = this._selectedNode()
    if (!node || !node.descriptiveText) return
    nova.clipboard.writeText(node.descriptiveText)
  }

  _selectedNode() {
    const selection = this._treeView ? this._treeView.selection : null
    const selected = selection && selection.length > 0 ? selection[0] : null
    if (!selected) return null
    // Selection elements should already be the exact node objects getChildren() returned, but
    // resolve through the canonical map by identifier too in case Nova hands back a copy.
    return this._nodesById.get(selected.identifier) || selected
  }

  // Nova's sidebar API has no persistent/inline search field (only header-command buttons and
  // one-shot showInputPalette() prompts — see CLAUDE.md's "Reference sidebar" section), so the
  // active filter has nowhere native to display. This synthetic root node is the substitute:
  // pinned above the real roots whenever a filter is active, showing the query text (and how
  // many top-level branches still match), with double-click wired to clear it.
  _buildStatusNode(visibleRootCount) {
    const name = visibleRootCount === 0
      ? `No matches for "${this._filterQuery}"`
      : `Filter: "${this._filterQuery}"`
    return {
      identifier: '__filter_status__',
      kind: 'status',
      name,
      children: [],
      descriptiveText: 'Double-click to clear',
    }
  }

  // -- TreeDataProvider --------------------------------------------------

  getChildren(element) {
    if (!element) {
      if (!this._filter) return this._roots
      const visibleRoots = this._roots.filter((child) => this._filter.visible.has(child.identifier))
      return [this._buildStatusNode(visibleRoots.length), ...visibleRoots]
    }

    const children = element.children || []
    if (!this._filter) return children
    return children.filter((child) => this._filter.visible.has(child.identifier))
  }

  getTreeItem(node) {
    if (node.kind === 'status') {
      const item = new TreeItem(node.name, TreeItemCollapsibleState.None)
      item.identifier = node.identifier
      item.descriptiveText = node.descriptiveText
      item.tooltip = 'Double-click, or right-click and choose Clear Filter, to clear it.'
      item.command = 'garrill.tailwind.sidebar.clearFilter'
      item.image = 'filter' // same custom asset as the header command's Filter button
      // Scopes extension.json's "contextCommands" Clear Filter entry to just this row — Nova
      // has no inline/always-visible row-button API, only double-click (`command`, above) and a
      // right-click context menu scoped by contextValue.
      item.contextValue = 'filter-status'
      return item
    }

    const hasChildren = Array.isArray(node.children) && node.children.length > 0
    let collapsibleState = TreeItemCollapsibleState.None

    if (hasChildren) {
      if (this._filter) {
        collapsibleState = TreeItemCollapsibleState.Expanded
      } else if (this._forceExpanded === true) {
        collapsibleState = TreeItemCollapsibleState.Expanded
      } else {
        collapsibleState = TreeItemCollapsibleState.Collapsed
      }
    }

    const item = new TreeItem(node.name, collapsibleState)
    item.identifier = node.identifier
    if (node.descriptiveText) item.descriptiveText = node.descriptiveText
    if (node.tooltip) item.tooltip = node.tooltip
    if (node.color) {
      // `image` takes priority over `color` when both are set, so a color leaf (e.g.
      // bg-red-500) keeps its swatch instead of the generic style-class glyph.
      item.color = hexToColor(node.color)
    } else if (NODE_IMAGES[node.kind]) {
      item.image = NODE_IMAGES[node.kind]
    }
    const copyable = node.kind === 'class' || node.kind === 'variant'
    if (copyable) {
      item.command = 'garrill.tailwind.sidebar.insertClass'
    }
    // contextValue drives extension.json's "contextCommands" `when` clauses. Copy Class Name/CSS
    // only make sense on a concrete class/variant leaf; Open in Tailwind Docs only where
    // resolveDocSlug()/resolveVariantDocSlug() actually found one (not every family node resolves
    // to a single doc page — see sidebar-data.js). A node can qualify for both, so the two facts
    // are folded into one of four contextValue strings rather than trying to layer separate ones,
    // since TreeItem.contextValue only holds a single value.
    if (copyable && node.docUrl) {
      item.contextValue = 'docs+copy'
    } else if (copyable) {
      item.contextValue = 'copy'
    } else if (node.docUrl) {
      item.contextValue = 'docs'
    }
    return item
  }
}
