import Image from 'next/image'
import Link from 'next/link'
import { cn } from '@/lib/cn'

interface BrandMarkProps {
  /** `light` on parchment (forest roundel), `dark` on forest surfaces (parchment roundel, forest letters). */
  tone?: 'light' | 'dark'
  /**
   * Hide the wordmark below 480px (it stays in the accessible name). The header uses this so the 320px bar fits the
   * roundel, the primary action and the menu trigger on one line.
   */
  compact?: boolean
}

/**
 * The PG brand: the logo image (public/brand/logo.png, a cropped 256px copy of the master) plus the live-text wordmark
 * "PAWN'S GAMBIT", linking home. Logo and wordmark are decorative (`aria-hidden`); the link name is "Pawn's Gambit, home"
 * at every width, including when `compact` hides the wordmark. The logo carries its own background, so `tone` only
 * affects the wordmark. Server Component.
 */
export function BrandMark({ tone = 'light', compact = false }: BrandMarkProps) {
  return (
    <Link
      href="/"
      // Contains the visible wordmark, so the spoken name matches what sighted users see (WCAG 2.5.3).
      aria-label="Pawn's Gambit, home"
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center gap-3 rounded-public',
        tone === 'dark' ? 'text-parchment' : 'text-ink',
      )}
    >
      <Image
        src="/brand/logo.png"
        alt=""
        aria-hidden="true"
        width={36}
        height={36}
        className="size-9 shrink-0 rounded-full object-cover"
      />
      <span
        aria-hidden="true"
        className={cn(
          'font-display text-lg leading-none font-semibold tracking-tight whitespace-nowrap',
          compact && 'hidden xs:inline',
        )}
      >
        PAWN&apos;S GAMBIT
      </span>
    </Link>
  )
}
