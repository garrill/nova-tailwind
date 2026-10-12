'use strict'

/*
  Pure, nova.*-independent data layer for the Tailwind reference sidebar (Scripts/sidebar-
  provider.js wraps this as a Nova TreeDataProvider). Like completion-provider.js/theme-merge.js,
  this can be exercised outside Nova with a small stub — see CLAUDE.md's testing notes.

  buildSidebarTree(theme) regroups completion-provider.js#buildCompletionData(theme)'s flat
  output into a browsable hierarchy (Category -> docs page -> concrete class, following
  tailwindcss.com/docs's own navigation — see docs.js's DOC_SECTIONS — plus a top-level Variants
  branch and an optional Custom branch), reusing all of its label/detail/color resolution rather
  than re-deriving it. buildPropertyIndex() builds a `CSS property name ->
  family/prefix` lookup straight from UTILITY_FAMILIES's structured `props` data (or, for
  `static`-kind families, by extracting property names out of their hand-authored `css` text),
  at the family level rather than enumerating every generated class instance — a Tailwind docs
  page for "Padding" lists the family once, not once per spacing step. filterTree() computes the
  set of nodes a text/property query should keep visible (matches plus their ancestor chain).

  Node shape (plain objects, not Nova TreeItems):
  {
    identifier: string,       // stable, unique across the whole tree
    kind: 'category' | 'page' | 'class' | 'variant',
    name: string,              // display label
    parentId: string | null,
    children?: node[],         // present (possibly empty) on category/page nodes
    descriptiveText?: string,  // leaf only — the resolved CSS, e.g. "padding: 16px (1rem);"
    tooltip?: string,          // page: the docs page's one-line description
    color?: string,            // leaf only — resolved hex, converted to a Nova Color by the caller
    insertText?: string,       // leaf only — text to insert on double-click
    searchText?: string,       // leaf only — lowercased insertText, for substring filtering
    familyId?: string,         // leaf only (class kind) — for property-index matching
    prefix?: string | null,    // leaf only (class kind) — which family.prefixes entry produced it
    docSlug?: string | null,   // class leaf only — the docs page's slug, see resolveDocSlug()
    docUrl?: string | null,    // the docs page — see resolveDocSlug()/resolveVariantDocSlug()
  }
*/

const { UTILITY_FAMILIES } = require('./data/utilities.js')
const { VARIANTS } = require('./data/variants.js')
const {
  DOC_SECTIONS, PROPERTY_DOC_SLUGS, PREFIX_DOC_SLUG_OVERRIDES, STATIC_DOC_SLUG_OVERRIDES,
} = require('./data/docs.js')
const { buildCompletionData } = require('./completion-provider.js')

const VARIANTS_ROOT_ID = 'variants'
const CUSTOM_ROOT_ID = 'custom'

const DOC_BASE_URL = 'https://tailwindcss.com/docs/'

// Finds the docs page for the first declaration in a hand-authored `"property: value; ..."`
// string (same convention buildPropertyIndex() relies on) whose property has one. A
// `filter`/`backdrop-filter` value that's a single function (`grayscale(100%)`) goes to that
// function's own page (`filter-grayscale`), next to the same function's scale classes.
const DECLARATION_PATTERN = /([a-z-]+)\s*:\s*([^;]*)/g

function firstDocumentedProperty(cssText) {
  DECLARATION_PATTERN.lastIndex = 0
  let match
  while ((match = DECLARATION_PATTERN.exec(cssText))) {
    const [, property, value] = match
    const filterFunction = /^(?:backdrop-)?filter$/.test(property) && value.match(/^([a-z-]+)\(/)
    if (filterFunction && DOC_PAGES.has(`${property}-${filterFunction[1]}`)) {
      return `${property}-${filterFunction[1]}`
    }
    const slug = PROPERTY_DOC_SLUGS[property]
    if (slug) return slug
  }
  return null
}

// Resolves which tailwindcss.com/docs/<slug> page documents a given class leaf, for the
// sidebar's "Open in Tailwind Docs" right-click command. `static`-kind items carry their real
// CSS in `detail` (see completion-provider.js's buildCompletionData()), so the property can be
// read straight off it (STATIC_DOC_SLUG_OVERRIDES covers the multi-property classes whose
// first property isn't where the docs put them). Other kinds may describe their `props` with non-CSS text instead (e.g.
// `'scale (x)'`) purely for display — PREFIX_DOC_SLUG_OVERRIDES hand-maps those specific cases;
// see docs.js's comment on both tables for why.
function resolveDocSlug(family, label, prefix, detail) {
  if (!family) return null
  if (family.kind === 'static') {
    return STATIC_DOC_SLUG_OVERRIDES[label] || firstDocumentedProperty(detail)
  }

  const override = PREFIX_DOC_SLUG_OVERRIDES[`${family.id}::${prefix}`]
  if (override) return override

  const prefixEntry = (family.prefixes || []).find((p) => p.prefix === prefix)
  if (!prefixEntry) return null
  for (const prop of prefixEntry.props) {
    if (PROPERTY_DOC_SLUGS[prop]) return PROPERTY_DOC_SLUGS[prop]
  }
  return null
}

// Variants aren't individually documented — bucket them onto the handful of Tailwind docs pages
// that actually cover them (breakpoints/container queries share the responsive-design page).
function resolveVariantDocSlug(label) {
  if (label === 'dark' || label === 'light') return 'dark-mode'
  if (/^(max-)?(sm|md|lg|xl|2xl)$/.test(label)) return 'responsive-design'
  if (label.startsWith('@')) return 'responsive-design'
  return 'hover-focus-and-other-states'
}

// Given a generated label like `pt-4`, finds which of a family's `{prefix, props}` entries
// produced it — the longest matching prefix wins (`pt` over `p` for `pt-4`).
function derivePrefix(label, family) {
  if (!family.prefixes) return null
  const sorted = [...family.prefixes].sort((a, b) => b.prefix.length - a.prefix.length)
  for (const { prefix } of sorted) {
    if (label === prefix || label.startsWith(`${prefix}-`)) return prefix
  }
  return null
}

function buildClassLeaf(entry, family) {
  const familyId = family ? family.id : null
  const prefix = family ? derivePrefix(entry.label, family) : null
  const identifier = `class:${familyId || 'custom'}:${entry.label}`

  const tooltipParts = [entry.detail]
  if (entry.documentation) tooltipParts.push(entry.documentation)

  const docSlug = resolveDocSlug(family, entry.label, prefix, entry.detail)

  return {
    identifier,
    kind: 'class',
    name: entry.label,
    parentId: null, // set by the caller once it knows which node this hangs under
    descriptiveText: entry.detail,
    tooltip: tooltipParts.join('\n'),
    color: entry.color,
    insertText: entry.label,
    searchText: entry.label.toLowerCase(),
    familyId,
    prefix,
    docSlug,
    docUrl: docSlug ? `${DOC_BASE_URL}${docSlug}` : null,
  }
}

function buildVariantLeaf(entry) {
  return {
    identifier: `variant:${entry.label}`,
    kind: 'variant',
    name: entry.label,
    parentId: VARIANTS_ROOT_ID,
    descriptiveText: entry.detail,
    tooltip: entry.documentation,
    insertText: `${entry.label}:`, // mirrors completion-provider.js's own `isVariant` convention
    searchText: entry.label.toLowerCase(),
    docUrl: `${DOC_BASE_URL}${resolveVariantDocSlug(entry.label)}`,
  }
}

// slug -> { section, title, description, order } from docs.js's DOC_SECTIONS, plus each
// section's position in the docs nav, so categories and pages are listed in the docs' order.
const DOC_PAGES = new Map()
const SECTION_ORDER = new Map()
DOC_SECTIONS.forEach((section, sectionIndex) => {
  SECTION_ORDER.set(section.name, sectionIndex)
  section.pages.forEach((page, pageIndex) => {
    DOC_PAGES.set(page.slug, {
      section: section.name,
      title: page.title || page.slug,
      description: page.description,
      order: pageIndex,
    })
  })
})

// Every class leaf hangs under the docs page that documents it (Category -> page -> class), so
// a property's classes are always together in one folder however utilities.js happens to split
// them into families (e.g. width's spacing-scale, container-size, keyword and fraction
// families all land under one `width` page). A leaf whose page isn't in DOC_SECTIONS (shouldn't
// happen, but utilities.js and the docs can drift) falls back to its family's category, in an
// `other` page.
function pageFor(leaf, family) {
  const page = leaf.docSlug ? DOC_PAGES.get(leaf.docSlug) : null
  if (page) return { slug: leaf.docSlug, ...page }
  return { slug: null, section: family.category, title: 'other', description: null, order: Infinity }
}

function buildSidebarTree(theme) {
  const data = buildCompletionData(theme)
  const nodesById = new Map()

  const entriesByFamily = new Map()
  const variantEntries = []
  const customEntries = []
  for (const entry of data) {
    if (entry.isVariant) { variantEntries.push(entry); continue }
    if (entry.category === 'Custom') { customEntries.push(entry); continue }
    if (!entriesByFamily.has(entry.familyId)) entriesByFamily.set(entry.familyId, [])
    entriesByFamily.get(entry.familyId).push(entry)
  }

  const categoryNodes = new Map() // section name -> node
  const pageNodes = new Map() // page identifier -> node
  const pageOrder = new Map() // page identifier -> position in its section's docs nav

  // Leaves within a page keep UTILITY_FAMILIES's source order (families in order, each
  // family's items in order).
  for (const family of UTILITY_FAMILIES) {
    for (const entry of entriesByFamily.get(family.id) || []) {
      const leaf = buildClassLeaf(entry, family)
      const page = pageFor(leaf, family)

      let catNode = categoryNodes.get(page.section)
      if (!catNode) {
        catNode = {
          identifier: `category:${page.section}`,
          kind: 'category',
          name: page.section,
          parentId: null,
          children: [],
        }
        categoryNodes.set(page.section, catNode)
        nodesById.set(catNode.identifier, catNode)
      }

      const pageId = page.slug ? `page:${page.slug}` : `page:other:${page.section}`
      let pageNode = pageNodes.get(pageId)
      if (!pageNode) {
        pageNode = {
          identifier: pageId,
          kind: 'page',
          name: page.title,
          parentId: catNode.identifier,
          tooltip: page.description,
          children: [],
          docUrl: page.slug ? `${DOC_BASE_URL}${page.slug}` : null,
        }
        pageNodes.set(pageId, pageNode)
        pageOrder.set(pageId, page.order)
        nodesById.set(pageId, pageNode)
        catNode.children.push(pageNode)
      }

      leaf.parentId = pageId
      // The page's one-line description, so a leaf reached by filtering or expanding still
      // says what it's for without hovering its parent row.
      if (page.description) leaf.tooltip += `\n${page.description}`
      nodesById.set(leaf.identifier, leaf)
      pageNode.children.push(leaf)
    }
  }

  // Unknown positions are Infinity; `|| 0` turns Infinity - Infinity (NaN) into a tie, which
  // keeps the comparator consistent (and the sort stable) when several are unknown.
  const byDocsOrder = (order) => (a, b) => (order(a) - order(b)) || 0
  const sectionPosition = (node) => SECTION_ORDER.has(node.name) ? SECTION_ORDER.get(node.name) : Infinity
  const roots = [...categoryNodes.values()].sort(byDocsOrder(sectionPosition))
  for (const catNode of roots) {
    catNode.children.sort(byDocsOrder((node) => pageOrder.get(node.identifier)))
  }

  const variantsNode = {
    identifier: VARIANTS_ROOT_ID,
    kind: 'category',
    name: 'Variants',
    parentId: null,
    children: variantEntries.map((entry) => {
      const leaf = buildVariantLeaf(entry)
      nodesById.set(leaf.identifier, leaf)
      return leaf
    }),
  }
  nodesById.set(variantsNode.identifier, variantsNode)
  roots.push(variantsNode)

  if (customEntries.length > 0) {
    const customNode = {
      identifier: CUSTOM_ROOT_ID,
      kind: 'category',
      name: 'Custom',
      parentId: null,
      children: customEntries.map((entry) => {
        const leaf = buildClassLeaf(entry, null)
        leaf.parentId = CUSTOM_ROOT_ID
        nodesById.set(leaf.identifier, leaf)
        return leaf
      }),
    }
    nodesById.set(customNode.identifier, customNode)
    roots.push(customNode)
  }

  return { roots, nodesById }
}

// Extracts leading `property:` tokens out of a hand-authored `"property: value; ..."` string —
// safe given the consistent authoring convention utilities.js already relies on elsewhere.
const PROPERTY_TOKEN_PATTERN = /([a-z-]+)\s*:/g

function buildPropertyIndex(families = UTILITY_FAMILIES) {
  // lowercased property name -> [{ familyId, discriminator }]. `discriminator` is what actually
  // produced the property within that family: a `{prefix, props}` entry's `prefix` for
  // scale/color/numericList kinds (all items sharing that prefix share the property, e.g. every
  // tracking-* class), or a `static`-kind item's own `label` — NOT the whole family, since a
  // static family bundles unrelated standalone classes purely for authoring convenience (e.g.
  // Layout's static family's `sr-only` sets `border-width: 0` as one of several visually-hidden
  // reset properties, but none of Layout's other ~80 classes do).
  const index = new Map()

  function addEntry(rawProperty, familyId, discriminator) {
    const key = rawProperty.trim().toLowerCase()
    if (!key) return
    if (!index.has(key)) index.set(key, [])
    index.get(key).push({ familyId, discriminator })
  }

  for (const family of families) {
    if (family.kind === 'static') {
      for (const item of family.items) {
        PROPERTY_TOKEN_PATTERN.lastIndex = 0
        let match
        while ((match = PROPERTY_TOKEN_PATTERN.exec(item.css))) {
          addEntry(match[1], family.id, item.label)
        }
      }
      continue
    }
    for (const { prefix, props } of family.prefixes || []) {
      for (const prop of props) addEntry(prop, family.id, prefix)
    }
  }

  return index
}

// CSS property names in the index are hyphenated (`max-height`), but it's natural to type a
// space instead (`max height`) when searching — collapse whitespace/underscore runs to a single
// hyphen so both spellings hit the same index key.
function normalizeSeparators(s) {
  return s.trim().toLowerCase().replace(/[\s_]+/g, '-')
}

// Finds every class leaf whose CSS property matches `propQuery` (exact key match first,
// substring fallback — e.g. `padding` surfaces every padding-* family's properties too). Matches
// per-leaf, using the leaf's own `prefix` (scale/color/numericList kinds) or its own `name`
// (static-kind leaves, where `prefix` is always null) as the same discriminator
// buildPropertyIndex() recorded — see its comment for why this can't be family-level for static
// kinds.
function matchByProperty(nodesById, propertyIndex, propQuery) {
  const matched = new Set()
  let hits = propertyIndex.get(propQuery)
  if (!hits || hits.length === 0) {
    hits = []
    for (const [key, list] of propertyIndex) {
      if (key.includes(propQuery)) hits.push(...list)
    }
  }
  const matchKeys = new Set(hits.map((h) => `${h.familyId}:${h.discriminator}`))

  for (const node of nodesById.values()) {
    if (node.kind !== 'class') continue
    const key = `${node.familyId}:${node.prefix || node.name}`
    if (matchKeys.has(key)) matched.add(node.identifier)
  }
  return matched
}

// Finds every class/variant leaf whose label matches `textQuery`, and separately every docs
// page whose name matches — a matched page shows all of its leaves (see filterTree()) without
// each one being added as a match.
function matchByName(nodesById, textQuery) {
  const leaves = new Set()
  const pages = new Set()
  for (const node of nodesById.values()) {
    if (node.kind === 'class' || node.kind === 'variant') {
      if (node.searchText.includes(textQuery)) leaves.add(node.identifier)
    } else if (node.kind === 'page') {
      if (node.name.toLowerCase().includes(textQuery)) pages.add(node.identifier)
    }
  }
  return { leaves, pages }
}

// A page showing more leaves than this while filtering stays collapsed rather than forced open
// — a broad query (`color`, `border`) would otherwise expand pages of thousands of rows (e.g.
// border-color), making Nova's tree reload slow.
const MAX_EXPANDED_PAGE_SIZE = 100

// Resolves a query into the set of node identifiers that should remain visible — matches plus
// their full ancestor chain — and which of those to show expanded, so a match is reachable
// without the user manually expanding anything (except inside pages over
// MAX_EXPANDED_PAGE_SIZE). `openPages` are pages matched by name, which show all their leaves. A bare query (e.g. `letter-spacing`) matches BOTH class/page names AND CSS
// property names, so searching a property (like `letter-spacing`) surfaces the classes that set
// it (`tracking-*`) even though the property name never appears in their labels. `prop:<name>`
// restricts the search to property names only, for when a property name happens to collide with
// unrelated class-name text.
function filterTree(nodesById, propertyIndex, query) {
  const trimmed = query.trim()
  if (trimmed === '') return null

  const propMatch = trimmed.match(/^prop:\s*(.+)$/i)
  let matched
  let openPages = new Set()

  if (propMatch) {
    const propQuery = normalizeSeparators(propMatch[1])
    matched = matchByProperty(nodesById, propertyIndex, propQuery)
  } else {
    const byName = matchByName(nodesById, trimmed.toLowerCase())
    openPages = byName.pages
    matched = new Set([
      ...byName.leaves,
      ...byName.pages,
      ...matchByProperty(nodesById, propertyIndex, normalizeSeparators(trimmed)),
    ])
  }

  const visible = new Set()
  function addWithAncestors(identifier) {
    let current = identifier
    while (current && !visible.has(current)) {
      visible.add(current)
      const node = nodesById.get(current)
      current = node ? node.parentId : null
    }
  }
  for (const id of matched) addWithAncestors(id)

  const expanded = new Set()
  for (const id of visible) {
    const node = nodesById.get(id)
    if (!node || !node.children) continue
    if (node.kind === 'page') {
      const shown = openPages.has(id)
        ? node.children.length
        : node.children.filter((child) => visible.has(child.identifier)).length
      if (shown > MAX_EXPANDED_PAGE_SIZE) continue
    }
    expanded.add(id)
  }

  return { visible, matched, openPages, expanded }
}

exports.buildSidebarTree = buildSidebarTree
exports.buildPropertyIndex = buildPropertyIndex
exports.filterTree = filterTree
