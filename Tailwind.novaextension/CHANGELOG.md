## Version 1.2

Tailwind reference sidebar: browse every utility class and variant in a Category → Family → Class tree (Extensions → Tailwind), filterable by class name or CSS property (e.g. `padding` or `letter-spacing` — searching `max height` also matches `max-height`), with expand/collapse-all and insert-on-double-click. Stays in sync with your project's custom theme, same as completions. Right-click a class, variant, or family for "Open in Tailwind Docs" (links straight to the specific tailwindcss.com/docs page for that item), "Copy Class Name", or "Copy CSS".

## Version 1.1

Custom theme support: point the extension at your project's Tailwind entry CSS file and it will read your `@theme`/`@utility` customizations — custom spacing, colors, and other scale overrides update completion hints to match, and custom `@utility` classes appear as completions too. An optional "Suppress default Tailwind colors" setting hides the default color palette entirely once you've defined your own.

## Version 1.0

Tailwind CSS v4.3 utility and variant completions, with color swatches and stacked-variant support (`md:hover:bg-blue-500`). Class/color/scale data generated from the `tailwindcss` npm package rather than hand-transcribed.
