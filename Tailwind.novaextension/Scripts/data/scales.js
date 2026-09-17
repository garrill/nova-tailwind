'use strict'

/*
  Small numeric/keyword scales that Tailwind does not publish as theme CSS variables
  (they're generated procedurally by the utility engine, e.g. `p-{n}` works for any
  integer n via `calc(var(--spacing) * n)`). These are the "commonly reached for"
  values worth suggesting, not an exhaustive/exclusive set — arbitrary values
  (`p-[13px]`) and any other integer always continue to work even if not listed here.
*/

// Tailwind's classic spacing steps (0.25rem base). Still what most people expect to
// see suggested, even though v4's `calc(var(--spacing) * n)` accepts any integer or
// decimal multiplier.
exports.SPACING_STEPS = [
  '0', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '5', '6', '7', '8', '9', '10',
  '11', '12', '14', '16', '20', '24', '28', '32', '36', '40', '44', '48', '52', '56',
  '60', '64', '72', '80', '96',
]

exports.FRACTIONS = [
  '1/2',
  '1/3', '2/3',
  '1/4', '2/4', '3/4',
  '1/5', '2/5', '3/5', '4/5',
  '1/6', '2/6', '3/6', '4/6', '5/6',
  '1/12', '2/12', '3/12', '4/12', '5/12', '6/12', '7/12', '8/12', '9/12', '10/12', '11/12',
]

exports.GRID_COUNTS = Array.from({ length: 12 }, (_, i) => String(i + 1))

exports.OPACITY_STEPS = ['0', '5', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55', '60', '65', '70', '75', '80', '85', '90', '95', '100']

exports.PERCENTAGE_STEPS = ['0', '25', '50', '75', '100']

exports.DURATION_STEPS = ['0', '75', '100', '150', '200', '300', '500', '700', '1000']

exports.CONTAINER_SIZE_KEYS = ['3xs', '2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl']
