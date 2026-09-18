'use strict'

/*
  Pure, nova.*-independent data layer for the Tailwind reference sidebar (Scripts/sidebar-
  provider.js wraps this as a Nova TreeDataProvider). Like completion-provider.js/theme-merge.js,
  this can be exercised outside Nova with a small stub — see CLAUDE.md's testing notes.

  buildSidebarTree(theme) regroups completion-provider.js#buildCompletionData(theme)'s flat
  output back into a browsable hierarchy (Category -> Family -> concrete class, plus a top-level
  Variants branch and an optional Custom branch), reusing all of its label/detail/color
  resolution rather than re-deriving it. buildPropertyIndex() builds a `CSS property name ->
  family/prefix` lookup straight from UTILITY_FAMILIES's structured `props` data (or, for
  `static`-kind families, by extracting property names out of their hand-authored `css` text),
  at the family level rather than enumerating every generated class instance — a Tailwind docs
  page for "Padding" lists the family once, not once per spacing step. filterTree() computes the
  set of nodes a text/property query should keep visible (matches plus their ancestor chain).

  Node shape (plain objects, not Nova TreeItems):
  {
    identifier: string,       // stable, unique across the whole tree
    kind: 'category' | 'family' | 'class' | 'variant',
    name: string,              // display label
    parentId: string | null,
    children?: node[],         // present (possibly empty) on category/family nodes
    descriptiveText?: string,  // leaf only — the resolved CSS, e.g. "padding: 16px (1rem);"
    tooltip?: string,
    color?: string,            // leaf only — resolved hex, converted to a Nova Color by the caller
    insertText?: string,       // leaf only — text to insert on double-click
    searchText?: string,       // leaf only — lowercased insertText, for substring filtering
    familyId?: string,         // leaf only (class kind) — for property-index matching
    prefix?: string | null,    // leaf only (class kind) — which family.prefixes entry produced it
    docUrl?: string | null,    // class/variant always; family only when every child agrees on one
                                // page — see resolveDocSlug()/resolveVariantDocSlug() below
  }
*/

const { UTILITY_FAMILIES } = require('./data/utilities.js')
const { VARIANTS } = require('./data/variants.js')
const { FAMILY_NAMES, FAMILY_DOCS, PROPERTY_DOC_SLUGS, PREFIX_DOC_SLUG_OVERRIDES } = require('./data/docs.js')
const { buildCompletionData } = require('./completion-provider.js')

const VARIANTS_ROOT_ID = 'variants'
const CUSTOM_ROOT_ID = 'custom'

const DOC_BASE_URL = 'https://tailwindcss.com/docs/'

// Extracts the first `property:` token from a hand-authored `"property: value; ..."` string
// (same convention buildPropertyIndex() relies on) that has a known docs page.
function firstDocumentedProperty(cssText) {
  PROPERTY_TOKEN_PATTERN.lastIndex = 0
  let match
  while ((match = PROPERTY_TOKEN_PATTERN.exec(cssText))) {
    const slug = PROPERTY_DOC_SLUGS[match[1]]
    if (slug) return slug
  }
  return null
}

// Resolves which tailwindcss.com/docs/<slug> page documents a given class leaf, for the
// sidebar's "Open in Tailwind Docs" right-click command. `static`-kind items carry their real
// CSS in `detail` (see completion-provider.js's buildCompletionData()), so the property can be
// read straight off it. Other kinds may describe their `props` with non-CSS text instead (e.g.
// `'scale (x)'`) purely for display — PREFIX_DOC_SLUG_OVERRIDES hand-maps those specific cases;
// see docs.js's comment on both tables for why.
function resolveDocSlug(family, prefix, detail) {
  if (!family) return null
  if (family.kind === 'static') return firstDocumentedProperty(detail)

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

  // static-kind families have no intermediate family node, so their one-line blurb is folded
  // into each leaf's tooltip instead (see docs.js's FAMILY_DOCS).
  const blurb = family && family.kind === 'static' ? FAMILY_DOCS[family.id] : null
  const tooltipParts = []
  if (blurb) tooltipParts.push(blurb)
  tooltipParts.push(entry.detail)
  if (entry.documentation) tooltipParts.push(entry.documentation)

  const docSlug = resolveDocSlug(family, prefix, entry.detail)

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

  const roots = []
  const categoryNodes = new Map() // category name -> node

  for (const family of UTILITY_FAMILIES) {
    let catNode = categoryNodes.get(family.category)
    if (!catNode) {
      catNode = {
        identifier: `category:${family.category}`,
        kind: 'category',
        name: family.category,
        parentId: null,
        children: [],
      }
      categoryNodes.set(family.category, catNode)
      nodesById.set(catNode.identifier, catNode)
      roots.push(catNode)
    }

    const entries = entriesByFamily.get(family.id) || []

    if (family.kind === 'static') {
      for (const entry of entries) {
        const leaf = buildClassLeaf(entry, family)
        leaf.parentId = catNode.identifier
        nodesById.set(leaf.identifier, leaf)
        catNode.children.push(leaf)
      }
      continue
    }

    const familyChildren = entries.map((entry) => {
      const leaf = buildClassLeaf(entry, family)
      leaf.parentId = `family:${family.id}`
      nodesById.set(leaf.identifier, leaf)
      return leaf
    })

    // Only offer a doc link on the family node itself when every child leaf agrees on one page —
    // a family like "Width / Height (Spacing Scale)" spans width/min-width/max-width/height/...,
    // each with its own doc page, so there's no single correct link to give the family node.
    const childDocUrls = new Set(familyChildren.map((c) => c.docUrl).filter(Boolean))

    const familyNode = {
      identifier: `family:${family.id}`,
      kind: 'family',
      name: FAMILY_NAMES[family.id] || family.id,
      parentId: catNode.identifier,
      tooltip: FAMILY_DOCS[family.id],
      children: familyChildren,
      docUrl: childDocUrls.size === 1 ? [...childDocUrls][0] : null,
    }
    nodesById.set(familyNode.identifier, familyNode)
    catNode.children.push(familyNode)
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
  // reset properties, but none of Layout's other ~80 classes do — see docs.js's blurb for
  // 'layout-static').
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

// Finds every class/variant leaf whose label matches `textQuery`, plus every family whose
// display name matches (which also pulls in all of that family's leaves).
function matchByName(nodesById, textQuery) {
  const matched = new Set()
  for (const node of nodesById.values()) {
    if (node.kind === 'class' || node.kind === 'variant') {
      if (node.searchText.includes(textQuery)) matched.add(node.identifier)
    } else if (node.kind === 'family') {
      if (node.name.toLowerCase().includes(textQuery)) {
        matched.add(node.identifier)
        for (const child of node.children) matched.add(child.identifier)
      }
    }
  }
  return matched
}

// Resolves a query into the set of node identifiers that should remain visible — matches plus
// their full ancestor chain, so a match is reachable without the user manually expanding
// anything. A bare query (e.g. `letter-spacing`) matches BOTH class/family names AND CSS
// property names, so searching a property (like `letter-spacing`) surfaces the classes that set
// it (`tracking-*`) even though the property name never appears in their labels. `prop:<name>`
// restricts the search to property names only, for when a property name happens to collide with
// unrelated class-name text.
function filterTree(nodesById, propertyIndex, query) {
  const trimmed = query.trim()
  if (trimmed === '') return null

  const propMatch = trimmed.match(/^prop:\s*(.+)$/i)
  let matched

  if (propMatch) {
    const propQuery = normalizeSeparators(propMatch[1])
    matched = matchByProperty(nodesById, propertyIndex, propQuery)
  } else {
    const q = trimmed.toLowerCase()
    matched = new Set([
      ...matchByName(nodesById, q),
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

  return { visible, matched }
}

exports.buildSidebarTree = buildSidebarTree
exports.buildPropertyIndex = buildPropertyIndex
exports.filterTree = filterTree
