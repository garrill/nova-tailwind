# Tailwind CSS Completions For Nova 

Autocompletion for [Tailwind CSS](https://tailwindcss.com) v4 utility classes and variants in [Nova](https://nova.app).

- Up-to-date with **Tailwind v4.3**
- Completes utility classes (`bg-`, `p-`, `flex`, `grid-cols-`, …) with a live color swatch for color-scale utilities.
- Completes variants (`hover:`, `md:`, `dark:`, `group-hover:`, `@lg:`, …) and lets them stack (`md:hover:bg-blue-500`), replacing only the segment you're typing.
- Understands the negative-value prefix (`-mt-4`) for utilities that support it.
- Works in HTML, PHP, Blade, ERB, Twig, Liquid, Pug/Jade, Markdown, Vue, Svelte, Astro, JavaScript/TypeScript (incl. JSX/TSX), and CSS/Sass/Scss files.
- Sidebar shows all utility classes for quick reference
- Filter sidebar by CSS property of Tailwind class.
- Custom theme overrides by importing `@theme`/`@utility` from your CSS file.
- Hover preview: hover a class to see its full CSS (see below).

## Requirements

The default class/color/scale data is generated ahead of time from the `tailwindcss` npm package and shipped with the extension. Reading a project's own theme CSS needs filesystem access, and the hover preview additionally needs permission to run processes and make network requests (to install and run Tailwind's language server).

## Hover preview

On by default. Turn it off for a project in **Project → Project Settings → Tailwind → Enable hover preview**.

- **Needs Node.js and npm.** The first time it runs, the extension installs Tailwind's official language server (`@tailwindcss/language-server`) via npm, which needs network access. It's installed into the extension's own storage, not your project. Without Node.js/npm, Nova shows a notification with a link to download Node.js and a button to turn hover preview off for that project; completions and the sidebar still work either way.
- **Nova only lets one language server provide hovers for each language.** If a language already has a server with hover enabled, such as Nova's built-in **HTML Language Server** or **CSS Language Server**, Tailwind's hovers won't show. To fix it, open **Nova → Settings → Languages**, pick the language, click the ⓘ next to its existing language server, and turn off hover in its **Features** tab. That server keeps providing completions, diagnostics and the rest. Repeat for each language you want Tailwind hovers in, e.g. HTML and CSS.

## Updating for a new Tailwind release (untested)

The default color palette and scale values (spacing base, font sizes, breakpoints, border radii, blur sizes, etc.) live in `Scripts/data/theme.generated.js`, generated from the pinned `tailwindcss` version in `gen/package.json`. To pick up a new release:

```sh
cd gen
npm install
npm run generate
```

This overwrites `Scripts/data/theme.generated.js`. The utility name/pattern tables in `Scripts/data/utilities.js` and `Scripts/data/variants.js` are hand-maintained separately (Tailwind doesn't publish "which utilities exist" as data) and need manual updates if Tailwind adds, removes, or renames utilities/variants.
