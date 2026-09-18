# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

This is a **Nova editor extension** (Panic's Nova.app, macOS) that provides autocompletion for
**Tailwind CSS v4** utility classes and variants, plus a sidebar for browsing/searching them
(including by CSS property). There is no build step — Nova loads the CommonJS-style JS in
`Tailwind.novaextension/Scripts/` directly via `require()`.

The extension itself lives entirely under `Tailwind.novaextension/` — that's the folder Nova
treats as the extension root (it's what gets opened in Nova, zipped for distribution, etc.). The
repo root just wraps it with `README.md`/`CHANGELOG.md`/`LICENSE`.

## Running and testing

Nova extensions have no CLI build/lint/test tooling.

- To try changes in Nova: open either the repo root or `Tailwind.novaextension` itself in Nova —
  Nova finds the `.novaextension` folder either way — then **Extensions → Activate Project as
  Extension**. Open a file whose language is in `extension.json`'s `activationEvents` (e.g.
  `.html`), and type inside a `class="..."` attribute or a `.css` file's `@apply`.
- **Extensions → Show Extension Console** shows `console.log`/error output.
- The completion logic (`Scripts/completion-provider.js`, `Scripts/class-parser.js`) has no
  dependency on the real Nova runtime beyond a handful of globals (`CompletionItem`,
  `CompletionItemKind`, `Color`, `Range`), so it can be exercised outside Nova with a small stub
  (Deno or Node) that fakes those globals and a `context` object — useful for quickly checking
  parsing/filtering logic changes without reloading the extension in Nova each time.
  `Scripts/sidebar-data.js` (the sidebar's tree/property-index/filter builder) is similarly
  dependency-free and stub-testable; `Scripts/sidebar-provider.js` additionally needs `TreeItem`/
  `TreeItemCollapsibleState` stubbed to exercise `getChildren`/`getTreeItem`.
- To regenerate the palette/scale data after bumping the pinned Tailwind version: `cd
  Tailwind.novaextension/gen && npm install && npm run generate` (needs Node — not required for
  the extension itself). See `README.md` for details.

## Architecture

```
Tailwind.novaextension/
  extension.json             – manifest: activationEvents, categories, configWorkspace (custom
                                 theme entry path), sidebars (Reference sidebar), entitlements
                                 (filesystem: readonly — needed to read a project's own theme
                                 CSS, see "Custom theme support")
  Images/
    sidebar-small/              – sidebar tab icon, 16px/32px (@2x) + metadata.json
    sidebar-large/              – sidebar tab icon, 24px/48px (@2x) + metadata.json
    filter/                     – Filter… header command icon, 16px/32px (@2x) + metadata.json
                                   Each is Nova's Image Asset Folder convention: an
                                   Images/{name}/ folder holding {name}.png + {name}@2x.png (PNG
                                   only — no flat SVG) and an optional metadata.json
                                   ({"template": true} — single-color, auto light/dark tinting),
                                   referenced from extension.json by folder name alone. No
                                   built-in icon fits "filter"/"search" (Nova's __builtin.* set
                                   is action/add/branch/next/path/previous/refresh/remote/remove)
                                   — confirmed against Nova's docs, not assumed — hence a custom
                                   asset for the Filter… button.
  Scripts/
    main.js                    – activate()/deactivate(); registers the CompletionProvider, the
                                  sidebar's TreeView + commands, and the shared ThemeCoordinator
    completion-provider.js     – builds the flat completion dataset once (exported as
                                  buildCompletionData(), reused by sidebar-data.js), then answers
                                  provideCompletionItems(editor, context) per keystroke
    class-parser.js            – extracts the partial class token before the cursor and
                                  splits it into `:`-stacked variant segments
    sidebar-data.js            – pure (no nova.* calls) tree-building for the Reference sidebar:
                                  regroups buildCompletionData()'s flat output back into
                                  Category → Family → class nodes, builds the CSS-property →
                                  family/prefix search index, and computes filter visibility
    sidebar-provider.js        – Nova TreeDataProvider wrapping sidebar-data.js: TreeItem
                                  construction, filter/expand-all UI state, rebuild(theme)
                                  (duck-types CompletionProvider#rebuild so ThemeCoordinator can
                                  call both), double-click-to-insert wiring
    insert-class-command.js    – inserts a class/variant token at the active editor's cursor
    color.js                   – hex → Nova Color() for completion-item/sidebar-leaf swatches
    theme-loader.js            – reads a project's configured theme entry CSS file plus any
                                  local `@import`s it follows (nova.fs/nova.path)
    theme-scanner.js           – dependency-free CSS tokenizer: extracts `@theme` declarations
                                  and `@utility` class names from project CSS
    theme-merge.js             – merges parsed project customizations over theme.generated.js
                                  (namespace clear/redefine, OKLCH→hex, etc.); pure, no nova.* calls
    theme-coordinator.js       – owns the scan/rebuild lifecycle: config, save/watch listeners,
                                  calls rebuild() on every registered provider (completion +
                                  sidebar)
    oklch-to-srgb.js           – vendored copy of gen/oklch-to-srgb.mjs's OKLCH→sRGB conversion,
                                  used by theme-merge.js at runtime (gen/'s copy is ESM/Node-only)
    data/
      theme.generated.js       – GENERATED — do not hand-edit; see gen/generate-theme.mjs
      utilities.js             – hand-maintained: which utility class families exist, each with
                                  a stable `id` used by completion-provider.js's `familyId` and
                                  by docs.js/sidebar-data.js
      variants.js               – hand-maintained: every variant token (hover, md, group-hover, …)
      scales.js                – hand-maintained: numeric/keyword scales Tailwind doesn't publish
                                  as theme CSS (spacing steps, fractions, opacity steps, …)
      docs.js                  – hand-maintained: FAMILY_NAMES/FAMILY_DOCS prose for the sidebar,
                                  keyed by utilities.js's family `id` — kept separate from
                                  utilities.js so that file stays structural/easy to diff
  gen/
    generate-theme.mjs         – Node script (NOT run by Nova) that regenerates theme.generated.js
                                  from the `tailwindcss` npm package's own theme.css
    oklch-to-srgb.mjs          – vendored OKLCH→sRGB conversion used by the generator
    package.json               – pins the `tailwindcss` devDependency version to generate from
```

(Paths elsewhere in this file, e.g. `Scripts/completion-provider.js` or `gen/generate-theme.mjs`,
are relative to `Tailwind.novaextension/` unless stated otherwise.)

### Data flow

Tailwind v4's utility *engine* (which prefixes exist, what they expand to) is compiled into the
`tailwindcss` package's JS/WASM build, not published as declarative data — so `utilities.js` and
`variants.js` are hand-authored against Tailwind's docs and need manual updates when Tailwind
adds/renames utilities or variants. The actual **scale values** (colors, spacing base, font
sizes, breakpoints, border radii, blur sizes, …) *are* published as plain CSS custom properties in
the `tailwindcss` package's `theme.css`, so those are machine-generated by `gen/generate-theme.mjs`
into `Scripts/data/theme.generated.js` — bumping to a new Tailwind release is a version bump +
`npm run generate`, not a re-transcription job. Colors are defined in OKLCH in `theme.css`; the
generator converts them to hex up front so the extension does zero color-space math at runtime.

`completion-provider.js#buildCompletionData()` cross-references `utilities.js` families against
`theme.generated.js` scales (and `scales.js` for values Tailwind doesn't publish, like spacing
steps) once, producing a flat array of
`{ label, detail, category, color?, allowNegation?, familyId? }`. The `detail` string is
deliberately *not* raw CSS — spacing/rem-based values are resolved to a `16px (1rem)` display
form (`formatSpacingValue`/`remToPxRem`) and font sizes to a `font: 18px/156%` shorthand
(`formatFontSizeShorthand`), since `calc(var(--spacing) * 4)` is technically accurate but useless
at a glance in a completion list. `familyId` mirrors the source `UTILITY_FAMILIES` object's `id`
(absent on variants/custom-utility entries) — it's not used by `provideCompletionItems` itself,
only by `sidebar-data.js`, which regroups this same flat array back into families rather than
re-deriving the label/detail/color logic a second time.

`provideCompletionItems` gates via `_isEligibleContext(editor, context)`, then asks
`class-parser.js` for the current partial segment and whether the cursor is inside an arbitrary
`[...]`/`(...)` value (if so, returns `null` — v1 doesn't complete inside arbitrary values), and
filters the flat dataset by that segment's text prefix, applying the `-` negative-prefix transform
for families that support it. It always offers both variant tokens and utility classes for the
current segment (rather than trying to guess which one the user is completing), since that's
ambiguous until they type the next character.

`_isEligibleContext` checks `editor.document.syntax` (`css`/`scss`/`sass`) *before* looking at
`context.selectors`, not after — Nova's built-in CSS grammar doesn't recognize `@apply`, so
`context.selectors` can come back **empty** inside it. Checking selectors first would silently
exclude `@apply` entirely (this was a real bug, found by testing in Nova). For CSS-family files,
eligibility is a plain regex over `context.line` (`_isInsideApplyDirective`) — only inside an
`@apply ...;` statement, not for ordinary selectors/property values. Elsewhere (HTML attributes,
JS/template string literals, etc.) it still uses `context.selectors`.

`main.js` registers `triggerChars` (`-:/.@`) when calling `registerCompletionAssistant`. Without
this, Nova dismisses the completion popup on any character its syntax doesn't treat as an
"identifier" character — which includes most of the characters Tailwind classes are built from —
and won't re-query any provider until the next identifier character. This is a Nova-wide behavior
(affects other extensions' completions too), not specific to this codebase, but the fix is local:
list the relevant punctuation as trigger characters.

### Custom theme support

The extension can also read a project's own Tailwind v4 CSS-based theme customizations, so hints
reflect a project's real values instead of only the default theme. This is opt-in: the user
points the `garrill.tailwind.themeEntryPath` workspace config setting (`configWorkspace` in
`extension.json`) at one entry CSS file (e.g. `src/app.css`); an unset path means default-theme-
only, same as before this feature existed.

`theme-coordinator.js` (constructed and started from `main.js#activate()`) owns the pipeline:
`theme-loader.js#loadThemeSources()` reads the entry file and recursively follows its *local*
relative `@import`s (not package imports like `@import "tailwindcss";`, which the generated
default theme already represents) → `theme-scanner.js#scanCss()` tokenizes each file's `@theme`
declarations and `@utility` class names → `theme-merge.js#mergeTheme()` layers those over
`theme.generated.js` into a runtime theme object (handling `--namespace-*: initial;`
namespace-wide resets and per-token `initial` reverts, in source order, and resolving `oklch()`/
`rgb()`/hex color values) → `CompletionProvider#rebuild(theme)` swaps in a freshly-built
completion dataset. Rescans are triggered by saving the entry file (or any file in its resolved
import chain) in Nova's editor, with a `nova.fs.watch` on the entry file itself as a defensive
fallback for changes made outside Nova (git checkout, another tool). Any failure at any stage
(missing file, unreadable, malformed CSS) falls back to `provider.rebuild()` with no argument —
default theme only, logged via `console.warn`/`console.error` — never breaks completions.

`theme-scanner.js`'s tokenizer is dependency-free (no npm CSS parser is available at runtime —
see "There is no build step" above) and brace-depth-aware, since a project's `@utility` bodies can
contain arbitrary nested CSS (media queries, `&:hover`, …) that a flat parser would misparse.
Like the rest of the completion logic, `scanCss()`/`mergeTheme()`/`classifyDeclaration()` have no
Nova-runtime dependency and can be exercised outside Nova with plain fixture strings/objects (see
"Running and testing" above).

A second workspace config setting, `garrill.tailwind.suppressDefaultColors` (boolean, default
`false`), makes `theme-merge.js#mergeTheme()` seed the `colors` namespace from `{}` instead of a
copy of `theme.generated.js`'s default palette (`options.suppressDefaultColors` in its signature)
— a blanket "only show colors I've defined" toggle, equivalent to writing `--color-*: initial;`
in the project's `@theme` block without having to actually write it. It's scoped to `colors` only
(that's what was asked for) and has no effect unless `themeEntryPath` is also set — with no entry
file there's no "your own colors" to show, so the toggle is ignored and the extension falls back
to defaults, same as an unset entry path always has. Both config keys are `observe()`d by
`theme-coordinator.js#start()` and either changing triggers a full rescan/rebuild.

Nova enforces filesystem access even for reads confined to the open workspace — reading the
entry file at all requires the `filesystem: readonly` entitlement in `extension.json` (found by
testing in Nova: the read throws `Extension "Tailwind" does not declare a read entitlement for
the file system` without it, matching how Nova's own bundled extensions declare it, e.g.
`filesystem: readwrite` in `CSS.novaextension`/`HTML.novaextension`'s manifests).

**Known v1 simplifications** (documented, not bugs): a single configured entry file rather than a
workspace-wide `*.css` scan; only *local* relative `@import`s are followed, not package imports;
`@theme inline`/`@theme static` are parsed identically to plain `@theme` (the modifier affects how
Tailwind's own generated CSS emits `var()` references, not the resolved value shown in
completions); functional `@utility name-* { ... }` utilities (using `--value()`/`--modifier()`)
are recognized and skipped, not surfaced as completions — only static `@utility name { ... }`
class names are.

**v1 scope, deliberately**: no reading of `tailwind.config.js`-style JS configuration (Tailwind v4
is CSS-config-first, so this isn't the common case) or of a project's arbitrary utility JS/plugin
code.

### Reference sidebar

A Nova sidebar (`extension.json`'s `sidebars` entry, `garrill.tailwind.sidebar`) lets the user
browse every Tailwind class and search by CSS property name — Nova's extension API has no live
search field or bulk expand/collapse control (that's native chrome in Nova's own bundled
sidebars, e.g. the Symbols sidebar's depth slider or the Project Files search field, not exposed
to extensions — confirmed against Nova's own docs, not assumed), so this is built from the
primitives that *are* available: header-command buttons and `nova.workspace.showInputPalette()`
for one-shot text prompts. The filter command is also reachable from Nova's own Command Palette
(⌘K) — `extension.json`'s `commands.command-palette` array lists it as "Tailwind: Filter
Sidebar"; a command registered at runtime via `nova.commands.register()` (main.js) needs this
manifest entry too, or it stays invocable only from wherever it's directly wired (the sidebar
header button), never from the Command Palette. Since there's nowhere native to *display* the active filter either (no
persistent field to show it in), `sidebar-provider.js#_buildStatusNode()` synthesizes one: a
`Filter: "<query>"` (or `No matches for "<query>"`) row pinned above the real root nodes whenever
a filter is active, wired to `clearFilter()` two ways: double-click (`TreeItem.command`), and a
right-click "Clear Filter" context menu item — Nova has no inline/always-visible row-button API
(confirmed against Nova's docs), only double-click and a `contextCommands` context menu scoped
by `TreeItem.contextValue`, which is why the status row sets `contextValue: 'filter-status'` and
`extension.json`'s section-level `contextCommands` scopes its one entry to
`"when": "viewItem == 'filter-status'"`. Its identifier
(`__filter_status__`) deliberately can't collide with any real node identifier, which are always
`category:`/`family:`/`class:`/`variant:`-prefixed.

`sidebar-data.js#buildSidebarTree(theme)` calls `completion-provider.js#buildCompletionData(theme)`
and regroups its flat output (keyed by the `familyId`/`category` each entry already carries) into
a `Category → Family → class` hierarchy, plus a top-level `Variants` branch and a `Custom` branch
(only present when `theme.customUtilities` is non-empty). `kind: 'static'` families (see
`utilities.js`'s entry-shape doc comment) contribute their items as direct children of the
Category node rather than through an intermediate Family node, since each item is already a
standalone concrete class bundled into one family object purely for authoring convenience.

`sidebar-data.js#buildPropertyIndex()` builds a `CSS property name → { familyId, prefix }[]`
lookup directly from each family's structured `props` array (for `scale`/`color`/`numericList`
kinds) or by regex-extracting property names out of `static`-kind items' `css` text — at the
*family* level, not by enumerating every generated class instance, since a Tailwind docs page for
"Padding" lists the family once, not once per spacing step. A bare sidebar filter query (e.g.
`letter-spacing`) matches BOTH class/family names AND this property index (exact match first,
substring fallback) at once — `sidebar-data.js#matchByName()`/`matchByProperty()` — so searching
a property surfaces the classes that set it even when the property name never appears in their
labels (`letter-spacing` → every `tracking-*` class). `prop:<name>` restricts the search to the
property index only, for the rare case a property name collides with unrelated class-name text.
`sidebar-data.js#filterTree()` returns the matched nodes plus their full ancestor chain, so
`sidebar-provider.js#getChildren()` can omit non-matching branches entirely (not just visually
collapse them) and `getTreeItem()` can force every node on a match's path to
`TreeItemCollapsibleState.Expanded` while a filter is active — matches are reachable without the
user manually expanding anything.

Double-clicking a leaf (`TreeItem.command` → `garrill.tailwind.sidebar.insertClass`, registered in
`main.js`) inserts its class/variant token at the active editor's cursor via
`insert-class-command.js#insertClass()`, a no-op (not a crash) when there's no active text editor.
Since Nova's docs don't confirm what argument (if any) is passed to a tree-item command's
callback, `sidebar-provider.js#insertSelectedClass()` reads `TreeView#selection` at invocation
time instead of relying on a callback argument.

Every `TreeItem.identifier` is built deterministically from node data (e.g. `family:padding`,
`class:padding:pt-4`) rather than array index/allocation order, so Nova's identifier-keyed
expansion-state tracking behaves correctly across `treeView.reload()` calls — both for filtering
and for the `Expand All`/`Collapse All` header commands, which set a tri-state
`SidebarDataProvider#_forceExpanded` flag rather than walking/mutating individual nodes.

`docs.js`'s `FAMILY_NAMES`/`FAMILY_DOCS` are threaded in as each Family node's display name and
tooltip; for `static`-kind families (no Family node), the blurb is folded into each leaf's
tooltip alongside its own resolved-CSS `detail` text instead.

`sidebar-provider.js`'s `NODE_IMAGES` maps each node kind to one of Nova's bundled `__symbol.*`
icons (originally meant for code-outline sidebars, but a semantically decent fit here too, and
free — no custom asset needed): `category` → `__symbol.category`, `family` → `__symbol.property`,
`class` → `__symbol.style-class`, `variant` → `__symbol.style-pseudoclass`. A `TreeItem` with
neither `image` nor `color` set falls back to Nova's generic placeholder glyph, which is why
every node needs one or the other. Color leaves (e.g. `bg-red-500`) get `color` instead of
`image` — never both, since Nova prioritizes `image` over `color` when both are set, which would
otherwise hide the swatch behind the generic class glyph.
