import { cn } from '@/lib/cn'

/**
 * Visual variant.
 *  primary    forest fill + parchment text (11.74:1). The default call to action.
 *  secondary  transparent + forest border and text (11.74:1 on parchment, 10.09 on sand).
 *  copper     the consequential event action (register, pay). See COPPER below: deviates from the reference for AA.
 *  ghost      no fill, inherits the text colour; use only when the hierarchy is obvious.
 * Inside a dark surface (`data-surface="dark"`, set by `Section tone="forest"` and `Surface tone="forest"`) every variant
 * switches to its dark counterpart with no prop (primary parchment fill, secondary parchment outline, copper-soft fill).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'copper' | 'ghost'

/**
 * Height. All sizes have a hit area of at least 44px.
 *  sm  36px visible, the `tap` utility extends the hit area to 44px. Dense toolbars and table rows.
 *  md  46px (reference `.button` minimum, public default).
 *  lg  48px (`min-h-control`: admin controls, form submits, primary mobile actions).
 */
export type ButtonSize = 'sm' | 'md' | 'lg'

// COPPER (approved by the owner 2026-10-23, TASK-026).
// The reference copper button is warm-white on the copper fill: 3.84:1, which fails AA for 0.72rem text, and no text
// colour reaches 4.5 on that fill (ink is 4.45). This build therefore uses copper-dark fill + warm-white text (6.01:1,
// AA) with copper-ink on hover (7.29:1). On dark surfaces: copper-soft fill + ink text (7.40:1).
// To go back to the reference look, replace COPPER_FILL and COPPER_HOVER below with:
//   COPPER_FILL  = 'border-transparent bg-copper text-warm-white in-data-[surface=dark]:bg-copper-soft in-data-[surface=dark]:text-ink'
//   COPPER_HOVER = 'hover:bg-copper-dark in-data-[surface=dark]:hover:bg-copper-pale'
const COPPER_FILL =
  'border-transparent bg-copper-dark text-warm-white in-data-[surface=dark]:bg-copper-soft in-data-[surface=dark]:text-ink'
const COPPER_HOVER = 'hover:bg-copper-ink in-data-[surface=dark]:hover:bg-copper-pale'

// Class names are written out in full so the Tailwind scanner finds each one (never build them by concatenation).
const BASE =
  'inline-flex min-w-0 items-center justify-center gap-2 rounded-public border text-center type-button wrap-break-word select-none'

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'tap min-h-9 px-3 py-2',
  md: 'min-h-11.5 px-4 py-3',
  lg: 'min-h-control px-6 py-3',
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-forest text-parchment in-data-[surface=dark]:bg-parchment in-data-[surface=dark]:text-forest',
  secondary:
    'border-forest bg-transparent text-forest in-data-[surface=dark]:border-parchment in-data-[surface=dark]:text-parchment',
  copper: COPPER_FILL,
  ghost: 'border-transparent bg-transparent',
}

const HOVER_CLASS: Record<ButtonVariant, string> = {
  primary: 'hover:bg-forest-soft in-data-[surface=dark]:hover:bg-sand',
  secondary: 'hover:bg-line in-data-[surface=dark]:hover:bg-line-light',
  copper: COPPER_HOVER,
  ghost: 'hover:bg-line in-data-[surface=dark]:hover:bg-line-light',
}

interface ButtonClassOptions {
  variant: ButtonVariant
  size: ButtonSize
  fullWidth: boolean
  /** Disabled or loading: no hover colour, no lift, not-allowed or progress cursor. */
  blocked: boolean
  loading: boolean
  className?: string
}

/** Class list for a button-looking control. Exported so a Radix trigger or a router link can borrow the look. */
export function buttonClassName({ variant, size, fullWidth, blocked, loading, className }: ButtonClassOptions): string {
  return cn(
    BASE,
    SIZE_CLASS[size],
    VARIANT_CLASS[variant],
    fullWidth && 'w-full',
    blocked
      ? loading
        ? 'cursor-progress'
        : 'cursor-not-allowed opacity-60'
      : cn(HOVER_CLASS[variant], 'cursor-pointer lift-on-hover'),
    className,
  )
}
