# Tailwind CSS

Autocompletion for [Tailwind CSS](https://tailwindcss.com) v4 utility classes and variants in
[Nova](https://nova.app).

- Completes utility classes (`bg-`, `p-`, `flex`, `grid-cols-`, …) with a live color swatch for
  color-scale utilities.
- Completes variants (`hover:`, `md:`, `dark:`, `group-hover:`, `@lg:`, …) and lets them stack
  (`md:hover:bg-blue-500`), replacing only the segment you're typing.
- Understands the negative-value prefix (`-mt-4`) for utilities that support it.
- Works in HTML, PHP, Blade, ERB, Twig, Liquid, Pug/Jade, Markdown, Vue, Svelte, Astro,
  JavaScript/TypeScript (incl. JSX/TSX), and CSS/Sass/Scss files.

## Scope

This extension ships completions for Tailwind's **default v4.3 theme only** — it does not read a
project's own `@theme`/`@utility` customizations in its CSS. If your project has customized its
theme, its custom class names won't appear in the completion list (though the defaults still
will).

Completions don't try to complete *inside* arbitrary values (`bg-[#1da1f2]`) or CSS-variable
shorthands (`p-(--my-spacing)`) — typing those is left alone rather than interfered with.

## Requirements

None — no external tools, no `tailwind.config.js` scanning, and no filesystem/process
entitlements are needed at runtime. The class/color/scale data is generated ahead of time from
the `tailwindcss` npm package (see `gen/`) and shipped with the extension.

## Updating for a new Tailwind release

The default color palette and scale values (spacing base, font sizes, breakpoints, border radii,
blur sizes, etc.) live in `Scripts/data/theme.generated.js`, generated from the pinned
`tailwindcss` version in `gen/package.json`. To pick up a new release:

```sh
cd gen
npm install
npm run generate
```

This overwrites `Scripts/data/theme.generated.js`. The utility name/pattern tables in
`Scripts/data/utilities.js` and `Scripts/data/variants.js` are hand-maintained separately (Tailwind
doesn't publish "which utilities exist" as data) and need manual updates if Tailwind adds, removes,
or renames utilities/variants.
