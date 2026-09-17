'use strict'

/*
  Reads a project's configured Tailwind theme entry CSS file and recursively follows local
  relative `@import` statements — not package imports like `@import "tailwindcss";`, which are
  already represented by the generated default theme (theme.generated.js). Nova's `nova.fs` API
  is synchronous, so this module is synchronous too.
*/

const IMPORT_PATTERN = /@import\s+(?:url\()?["']([^"']+)["']\)?[^;]*;/g

function readFileText(absolutePath) {
  const stats = nova.fs.stat(absolutePath)
  if (!stats || !stats.isFile()) return null

  const file = nova.fs.open(absolutePath, 'r', 'utf-8')
  if (!file) return null
  try {
    return file.readlines().join('')
  } finally {
    file.close()
  }
}

function isLocalImportSpecifier(specifier) {
  return specifier.startsWith('.') || specifier.startsWith('/')
}

function resolveImportPath(fromAbsolutePath, specifier) {
  const resolved = nova.path.isAbsolute(specifier)
    ? specifier
    : nova.path.join(nova.path.dirname(fromAbsolutePath), specifier)

  // `@import "./theme"` is valid CSS (extension-less) — try `.css` if the literal path is missing.
  if (nova.path.extname(resolved) === '' && !nova.fs.stat(resolved)) {
    const withCss = `${resolved}.css`
    if (nova.fs.stat(withCss)) return withCss
  }
  return resolved
}

function collectLocalImports(absolutePath, files, visited) {
  if (visited.has(absolutePath)) return // cycle-safe: already read, declarations already captured
  visited.add(absolutePath)

  const content = readFileText(absolutePath)
  if (content === null) {
    console.warn(`[Tailwind] theme CSS file not found or unreadable, skipping: ${absolutePath}`)
    return
  }

  // Recurse into local imports *before* recording this file's own content, so that
  // `files` (a Map, insertion-ordered) reflects real CSS cascade order — `@import`ed
  // declarations apply before the importing file's own declarations. This is a simplification:
  // it treats every import as if it appeared before the file's own @theme/@utility blocks,
  // rather than tracking each import's exact line position — true for the common convention of
  // putting @import statements at the top of the file, which is what Tailwind v4 itself expects.
  IMPORT_PATTERN.lastIndex = 0
  let match
  while ((match = IMPORT_PATTERN.exec(content))) {
    const specifier = match[1]
    if (!isLocalImportSpecifier(specifier)) continue // package/CDN import — skip, not re-scanned
    collectLocalImports(resolveImportPath(absolutePath, specifier), files, visited)
  }

  files.set(absolutePath, content)
}

/*
  Returns { files: Map<absolutePath, content>, entryAbsolutePath } for the configured entry file
  plus every local CSS file it (transitively) @imports, or null if the entry file itself doesn't
  exist/isn't readable. `entryPath` may be absolute or relative to `workspacePath`, since the
  "path"-type config field's returned value depends on its `relative` schema option.
*/
function loadThemeSources(workspacePath, entryPath) {
  if (!entryPath) return null

  const entryAbsolutePath = nova.path.isAbsolute(entryPath)
    ? entryPath
    : nova.path.join(workspacePath, entryPath)

  if (!nova.fs.stat(entryAbsolutePath)) return null

  const files = new Map()
  collectLocalImports(entryAbsolutePath, files, new Set())

  if (!files.has(entryAbsolutePath)) return null // entry itself failed to read

  return { files, entryAbsolutePath }
}

exports.loadThemeSources = loadThemeSources
