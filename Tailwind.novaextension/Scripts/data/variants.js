'use strict'

/*
  Hand-maintained table of every Tailwind v4 variant token — everything that can appear
  before the final `:` in a class like `md:hover:bg-blue-500`. Authored against
  https://tailwindcss.com/docs/hover-focus-and-other-states.

  Each entry is `{ label, doc }`. `label` is the literal variant token as typed
  (WITHOUT its trailing colon — the parser adds that back when inserting).
*/

exports.VARIANTS = [
  // Pseudo-classes
  { label: 'hover', doc: ':hover' },
  { label: 'focus', doc: ':focus' },
  { label: 'focus-within', doc: ':focus-within' },
  { label: 'focus-visible', doc: ':focus-visible' },
  { label: 'active', doc: ':active' },
  { label: 'visited', doc: ':visited' },
  { label: 'target', doc: ':target' },
  { label: 'first', doc: ':first-child' },
  { label: 'last', doc: ':last-child' },
  { label: 'only', doc: ':only-child' },
  { label: 'odd', doc: ':nth-child(odd)' },
  { label: 'even', doc: ':nth-child(even)' },
  { label: 'first-of-type', doc: ':first-of-type' },
  { label: 'last-of-type', doc: ':last-of-type' },
  { label: 'only-of-type', doc: ':only-of-type' },
  { label: 'empty', doc: ':empty' },
  { label: 'disabled', doc: ':disabled' },
  { label: 'enabled', doc: ':enabled' },
  { label: 'checked', doc: ':checked' },
  { label: 'indeterminate', doc: ':indeterminate' },
  { label: 'default', doc: ':default' },
  { label: 'optional', doc: ':optional' },
  { label: 'required', doc: ':required' },
  { label: 'valid', doc: ':valid' },
  { label: 'invalid', doc: ':invalid' },
  { label: 'user-valid', doc: ':user-valid' },
  { label: 'user-invalid', doc: ':user-invalid' },
  { label: 'in-range', doc: ':in-range' },
  { label: 'out-of-range', doc: ':out-of-range' },
  { label: 'placeholder-shown', doc: ':placeholder-shown' },
  { label: 'autofill', doc: ':autofill' },
  { label: 'read-only', doc: ':read-only' },

  // Pseudo-elements
  { label: 'before', doc: "::before (auto adds content: '')" },
  { label: 'after', doc: "::after (auto adds content: '')" },
  { label: 'placeholder', doc: '::placeholder' },
  { label: 'file', doc: '::file-selector-button' },
  { label: 'marker', doc: '::marker' },
  { label: 'selection', doc: '::selection' },
  { label: 'first-line', doc: '::first-line' },
  { label: 'first-letter', doc: '::first-letter' },
  { label: 'backdrop', doc: '::backdrop' },
  { label: 'details-content', doc: '::details-content' },

  // Media queries — breakpoints
  { label: 'sm', doc: 'width >= 40rem (640px)' },
  { label: 'md', doc: 'width >= 48rem (768px)' },
  { label: 'lg', doc: 'width >= 64rem (1024px)' },
  { label: 'xl', doc: 'width >= 80rem (1280px)' },
  { label: '2xl', doc: 'width >= 96rem (1536px)' },
  { label: 'max-sm', doc: 'width < 40rem' },
  { label: 'max-md', doc: 'width < 48rem' },
  { label: 'max-lg', doc: 'width < 64rem' },
  { label: 'max-xl', doc: 'width < 80rem' },
  { label: 'max-2xl', doc: 'width < 96rem' },

  // Media queries — other
  { label: 'dark', doc: 'prefers-color-scheme: dark' },
  { label: 'light', doc: 'prefers-color-scheme: light' },
  { label: 'motion-safe', doc: 'prefers-reduced-motion: no-preference' },
  { label: 'motion-reduce', doc: 'prefers-reduced-motion: reduce' },
  { label: 'contrast-more', doc: 'prefers-contrast: more' },
  { label: 'contrast-less', doc: 'prefers-contrast: less' },
  { label: 'forced-colors', doc: 'forced-colors: active' },
  { label: 'inverted-colors', doc: 'inverted-colors: inverted' },
  { label: 'portrait', doc: 'orientation: portrait' },
  { label: 'landscape', doc: 'orientation: landscape' },
  { label: 'print', doc: '@media print' },
  { label: 'noscript', doc: 'scripting: none' },
  { label: 'pointer-fine', doc: 'pointer: fine' },
  { label: 'pointer-coarse', doc: 'pointer: coarse' },
  { label: 'pointer-none', doc: 'pointer: none' },
  { label: 'any-pointer-fine', doc: 'any-pointer: fine' },
  { label: 'any-pointer-coarse', doc: 'any-pointer: coarse' },

  // Container queries
  { label: '@3xs', doc: 'container width >= 16rem' },
  { label: '@2xs', doc: 'container width >= 18rem' },
  { label: '@xs', doc: 'container width >= 20rem' },
  { label: '@sm', doc: 'container width >= 24rem' },
  { label: '@md', doc: 'container width >= 28rem' },
  { label: '@lg', doc: 'container width >= 32rem' },
  { label: '@xl', doc: 'container width >= 36rem' },
  { label: '@2xl', doc: 'container width >= 42rem' },
  { label: '@3xl', doc: 'container width >= 48rem' },
  { label: '@4xl', doc: 'container width >= 56rem' },
  { label: '@5xl', doc: 'container width >= 64rem' },
  { label: '@6xl', doc: 'container width >= 72rem' },
  { label: '@7xl', doc: 'container width >= 80rem' },

  // State variants
  { label: 'open', doc: '<details>/<dialog> open, or :popover-open' },
  { label: 'inert', doc: 'element has the inert attribute' },
  { label: 'starting', doc: '@starting-style — entry animations' },

  // Parent/sibling state
  { label: 'group-hover', doc: ':is(:where(.group):hover *)' },
  { label: 'group-focus', doc: ':is(:where(.group):focus *)' },
  { label: 'group-active', doc: ':is(:where(.group):active *)' },
  { label: 'group-has', doc: ':is(:where(.group):has(...) *) — pair with an arbitrary variant' },
  { label: 'peer-hover', doc: ':is(:where(.peer):hover ~ *)' },
  { label: 'peer-focus', doc: ':is(:where(.peer):focus ~ *)' },
  { label: 'peer-checked', doc: ':is(:where(.peer):checked ~ *)' },
  { label: 'peer-invalid', doc: ':is(:where(.peer):invalid ~ *)' },
  { label: 'peer-disabled', doc: ':is(:where(.peer):disabled ~ *)' },
  { label: 'in-hover', doc: ':where(:hover) * — implicit group, no class needed' },
  { label: 'in-focus', doc: ':where(:focus) * — implicit group, no class needed' },

  // Child selectors
  { label: '*', doc: 'direct children (& > *)' },
  { label: '**', doc: 'all descendants (& *)' },

  // ARIA
  { label: 'aria-busy', doc: '[aria-busy="true"]' },
  { label: 'aria-checked', doc: '[aria-checked="true"]' },
  { label: 'aria-disabled', doc: '[aria-disabled="true"]' },
  { label: 'aria-expanded', doc: '[aria-expanded="true"]' },
  { label: 'aria-hidden', doc: '[aria-hidden="true"]' },
  { label: 'aria-pressed', doc: '[aria-pressed="true"]' },
  { label: 'aria-readonly', doc: '[aria-readonly="true"]' },
  { label: 'aria-required', doc: '[aria-required="true"]' },
  { label: 'aria-selected', doc: '[aria-selected="true"]' },

  // RTL/LTR
  { label: 'rtl', doc: '[dir="rtl"]' },
  { label: 'ltr', doc: '[dir="ltr"]' },
]
