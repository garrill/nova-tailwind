# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

This is a **Nova editor extension** (Panic's Nova.app, macOS) that provides autocompletion for
**Tailwind CSS v4** utility classes and variants. There is no build step — Nova loads the
CommonJS-style JS in `Tailwind.novaextension/Scripts/` directly via `require()`.

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
- To regenerate the palette/scale data after bumping the pinned Tailwind version: `cd
  Tailwind.novaextension/gen && npm install && npm run generate` (needs Node — not required for
  the extension itself). See `README.md` for details.

## Architecture

```
Tailwind.novaextension/
  extension.json             – manifest: activationEvents, categories, configWorkspace (custom
                                 theme entry path), entitlements (filesystem: readonly — needed
                                 to read a project's own theme CSS, see "Custom theme support")
  Scripts/
    main.js                    – activate()/deactivate(); registers the CompletionProvider
    completion-provider.js     – builds the flat completion dataset once, then answers
                                  provideCompletionItems(editor, context) per keystroke
    class-parser.js            – extracts the partial class token before the cursor and
                                  splits it into `:`-stacked variant segments
    color.js                   – hex → Nova Color() for completion-item swatches
    theme-loader.js            – reads a project's configured theme entry CSS file plus any
                                  local `@import`s it follows (nova.fs/nova.path)
    theme-scanner.js           – dependency-free CSS tokenizer: extracts `@theme` declarations
                                  and `@utility` class names from project CSS
    theme-merge.js             – merges parsed project customizations over theme.generated.js
                                  (namespace clear/redefine, OKLCH→hex, etc.); pure, no nova.* calls
    theme-coordinator.js       – owns the scan/rebuild lifecycle: config, save/watch listeners,
                                  calls CompletionProvider#rebuild()
    oklch-to-srgb.js           – vendored copy of gen/oklch-to-srgb.mjs's OKLCH→sRGB conversion,
                                  used by theme-merge.js at runtime (gen/'s copy is ESM/Node-only)
    data/
      theme.generated.js       – GENERATED — do not hand-edit; see gen/generate-theme.mjs
      utilities.js             – hand-maintained: which utility class families exist
      variants.js               – hand-maintained: every variant token (hover, md, group-hover, …)
      scales.js                – hand-maintained: numeric/keyword scales Tailwind doesn't publish
                                  as theme CSS (spacing steps, fractions, opacity steps, …)
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
steps) once, producing a flat array of `{ label, detail, category, color?, allowNegation? }`. The
`detail` string is deliberately *not* raw CSS — spacing/rem-based values are resolved to a
`16px (1rem)` display form (`formatSpacingValue`/`remToPxRem`) and font sizes to a `font:
18px/156%` shorthand (`formatFontSizeShorthand`), since `calc(var(--spacing) * 4)` is technically
accurate but useless at a glance in a completion list.

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

**v1 scope, deliberately**: completions-only (no docs-browser sidebar, unlike some other Tailwind
Nova extensions); no reading of `tailwind.config.js`-style JS configuration (Tailwind v4 is
CSS-config-first, so this isn't the common case) or of a project's arbitrary utility JS/plugin
code.
