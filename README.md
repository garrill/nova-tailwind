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

Completions are based on Tailwind's **default v4.3 theme** out of the box. Optionally, point the
extension's "Custom theme entry CSS file" workspace setting at your project's Tailwind entry CSS
file (e.g. `src/app.css`), and it will also read that file's `@theme`/`@utility` customizations
(and any local files it `@import`s) — custom spacing/colors/etc. update the hint values shown, and
custom `@utility` classes appear as completions too. A second workspace setting, "Suppress default
Tailwind colors", hides Tailwind's default color palette from completions entirely once you've set
an entry file, so only the colors you've actually defined show up. See CLAUDE.md's "Custom theme
support" section for exactly what is and isn't supported (a single configured entry file, local
`@import`s only, static `@utility` classes only).

Completions don't try to complete *inside* arbitrary values (`bg-[#1da1f2]`) or CSS-variable
shorthands (`p-(--my-spacing)`) — typing those is left alone rather than interfered with.

## Requirements

No external tools and no `tailwind.config.js` scanning (Tailwind v4 is CSS-config-first). The
default class/color/scale data is generated ahead of time from the `tailwindcss` npm package (see
`Tailwind.novaextension/gen/`) and shipped with the extension. Reading a project's own theme CSS
(see "Scope" above) requires the `filesystem: readonly` entitlement declared in `extension.json` —
Nova enforces this even for reads confined to the open workspace — but no process/network
entitlements are needed.

## Updating for a new Tailwind release

The default color palette and scale values (spacing base, font sizes, breakpoints, border radii,
blur sizes, etc.) live in `Tailwind.novaextension/Scripts/data/theme.generated.js`, generated from
the pinned `tailwindcss` version in `Tailwind.novaextension/gen/package.json`. To pick up a new
release:

```sh
cd Tailwind.novaextension/gen
npm install
npm run generate
```

This overwrites `Scripts/data/theme.generated.js`. The utility name/pattern tables in
`Scripts/data/utilities.js` and `Scripts/data/variants.js` are hand-maintained separately (Tailwind
doesn't publish "which utilities exist" as data) and need manual updates if Tailwind adds, removes,
or renames utilities/variants.
