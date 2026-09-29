'use strict'

/*
  Pure helpers (no nova.* calls) for main.js's "Tailwind: Sort Classes" and "Tailwind: Sort
  All Classes in Document" commands, which hand the class lists these find to the language
  server's `@/tailwindCSS/sortSelection` request. The server does the actual ordering
  (Tailwind's own, as used by prettier-plugin-tailwindcss) and preserves each list's
  whitespace itself.
*/

// Opening quote of a `class`/`className`/`:class`/`v-bind:class`/`ng-class` attribute value, or
// a `class: '…'`/`className = "…"` key — the same names completion-provider.js treats as
// class-bearing (`_isClassAttributeValue`/`_looksLikeClassKey`).
const CLASS_VALUE_START = /(?:^|[\s:.{,(-])(?:class(?:name)?)\s*[:=]\s*(["'`])/gi

/*
  Finds every class list in `text`: the contents of each class attribute/key value and each
  `@apply …;` statement, as `{ start, end }` offsets (`end` exclusive), in document order. A
  value may span lines (the closing quote is searched for across the whole text). One with no
  closing quote/`;` is skipped, or with `allowUnterminated` runs to the end of `text` — used
  for a single line the user is still typing on.
*/
function findClassLists(text, { allowUnterminated = false } = {}) {
  const lists = []

  CLASS_VALUE_START.lastIndex = 0
  let match
  while ((match = CLASS_VALUE_START.exec(text)) !== null) {
    const start = match.index + match[0].length
    let end = text.indexOf(match[1], start)
    if (end < 0) {
      if (!allowUnterminated) continue
      end = text.length
    }
    lists.push({ start, end })
    CLASS_VALUE_START.lastIndex = end // resume after the value, not inside it
  }

  const apply = /@apply\s+/g
  while ((match = apply.exec(text)) !== null) {
    const start = match.index + match[0].length
    // Ends at `;`, or at the rule's `}` when the last declaration omits it.
    const ends = [text.indexOf(';', start), text.indexOf('}', start)].filter((i) => i >= 0)
    if (ends.length === 0 && !allowUnterminated) continue
    lists.push({ start, end: ends.length ? Math.min(...ends) : text.length })
  }

  return lists.sort((a, b) => a.start - b.start)
}

/*
  The class list around `column` in `line`, for a command run with nothing selected; `null` if
  the cursor isn't inside one.
*/
function findClassListAt(line, column) {
  return findClassLists(line, { allowUnterminated: true })
    .find(({ start, end }) => column >= start && column <= end) || null
}

// An arbitrary value/variant, e.g. `[70%]`, `[&>*]`, `['?']`. Tailwind doesn't allow whitespace
// inside one (it uses `_`), so a bracket containing spaces — e.g. `bg-[{{ color }}]` — isn't one.
const ARBITRARY = /\[[^[\]\s]*\]/g

/*
  False when `text` contains template syntax (Twig/Blade/Liquid `{{ }}`/`{% %}`/`{# #}`,
  Svelte/Astro `{}`, JS `${}`, PHP `<?php`/`<?=`, ERB `<% %>`, Blade `@if($x)`), which the
  server would sort as if it were class names and mangle. Checked outside arbitrary `[...]`
  values only, since those legitimately contain `%`, `<`, `>`, `{`, … (`bottom-[70%]`,
  `[&>*]:p-4`); `%` and `?` aren't checked at all (`from-10%` is a valid class), since every
  template syntax above also has a `{`, `<` or `$`.
*/
function isSortable(text) {
  if (text.trim() === '') return false
  let outsideArbitrary = text
  // Repeat for nested brackets, e.g. `[&_[data-open]]:block`.
  for (let previous = null; previous !== outsideArbitrary;) {
    previous = outsideArbitrary
    outsideArbitrary = outsideArbitrary.replace(ARBITRARY, '')
  }
  return !/[{}<>$]/.test(outsideArbitrary)
}

/*
  The part of a class list that can be sorted: everything before the first class containing
  template code (see isSortable), e.g. `px-6 flex` in `px-6 flex {{gridCols}} {{bgColor}}`.
  Everything from that class on is left exactly as it is, so classes inside a conditional
  (`{% if a %}p-4{% endif %}`) or after mid-list template code never move, and a class built
  from template code (`bg-{{color}}-500`) counts as template code as a whole.

  Returns `null` when nothing before the template code can be sorted, else `{ end, separator }`:
  `end` is where the sortable part ends (the start of the template code, or `text.length`), and
  `separator` is what should sit between the sorted classes and the template code once
  tidyWhitespace() has trimmed them — one space, or the line break + indentation before the
  template code if it starts a new line ('' when there's no template code).
*/
function sortablePart(text) {
  const token = /\S+/g
  let lastSortableEnd = -1
  let match
  while ((match = token.exec(text)) !== null) {
    if (!isSortable(match[0])) {
      if (lastSortableEnd < 0) return null
      const gap = text.slice(lastSortableEnd, match.index)
      return {
        end: match.index,
        separator: gap.includes('\n') ? '\n' + gap.slice(gap.lastIndexOf('\n') + 1) : ' ',
      }
    }
    lastSortableEnd = match.index + match[0].length
  }
  return lastSortableEnd < 0 ? null : { end: text.length, separator: '' }
}

/*
  Tidies a sorted class list's whitespace: trims the start and end, and collapses runs of
  spaces/tabs to one space. A multi-line list keeps its line breaks and each line's indentation,
  including a line break (plus indentation) at the very start or end — e.g. a closing quote on
  its own line — but loses trailing spaces and blank lines.
*/
function tidyWhitespace(list) {
  const body = list
    .split('\n')
    .map((line) => {
      const indent = /^[ \t]*/.exec(line)[0]
      const content = line.trim().replace(/[ \t]+/g, ' ')
      return content === '' ? '' : indent + content
    })
    .filter((line) => line !== '')
    .join('\n')
    .trim()
  if (body === '') return ''
  return lineBreakEdge(/^\s*/.exec(list)[0]) + body + lineBreakEdge(/\s*$/.exec(list)[0])
}

// Leading/trailing whitespace is dropped unless it contains a line break; then it becomes one
// line break plus the indentation that followed the last one.
function lineBreakEdge(whitespace) {
  if (!whitespace.includes('\n')) return ''
  return '\n' + whitespace.slice(whitespace.lastIndexOf('\n') + 1).replace(/[^ \t]/g, '')
}

exports.findClassLists = findClassLists
exports.findClassListAt = findClassListAt
exports.isSortable = isSortable
exports.sortablePart = sortablePart
exports.tidyWhitespace = tidyWhitespace
