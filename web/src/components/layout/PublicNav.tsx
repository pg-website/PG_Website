import type { Route } from 'next'
import { BrandMark } from '@/components/layout/BrandMark'
import { PublicAccountLink } from '@/components/layout/PublicAccountLink'
import { PublicMobileMenu } from '@/components/layout/PublicMobileMenu'
import { PublicNavLinks, type PublicNavItem } from '@/components/layout/PublicNavLinks'
import { Shell } from '@/components/layout/Shell'
import { Button } from '@/components/ui/Button'
import { ArrowRight } from '@/components/ui/icons/ArrowRight'
import { classifyHref } from '@/components/ui/linkHref'

/** Used when the CMS `nav` section has no usable primary links (reference screen 01 order). */
export const FALLBACK_NAV_ITEMS: readonly PublicNavItem[] = [
  { label: 'Play', href: '/play' },
  { label: 'Community', href: '/community' },
  { label: 'Stories', href: '/stories' },
  { label: 'Past events', href: '/past-events' },
]

/**
 * Static account link (HOME-PAGE-PLAN decision 5, HOME-02). TASK-023 later swaps it for "My PG" / "Admin" after
 * hydration without layout shift; until then it is plain HTML and the layout reads no session data.
 */
export const LOGIN_LINK: PublicNavItem = { label: 'Log in', href: '/login' }

/** Primary header action (reference screen 01). The `nav` CMS section has no field for it, so it is fixed copy. */
export const DEFAULT_NAV_ACTION: PublicNavItem = { label: 'Find my next game', href: '/play' }

const NAV_LABEL = 'Main'

/** Keeps only links the site can render as real links (site paths, http(s), mailto, tel). */
export function usableLinks(items: readonly PublicNavItem[] | undefined): PublicNavItem[] {
  return (items ?? []).filter((item) => item.label.trim() !== '' && classifyHref(item.href as Route) !== 'unsafe')
}

interface PublicNavProps {
  /** `nav.content.primary` from the site content. Missing, empty or all-unsafe lists fall back to FALLBACK_NAV_ITEMS. */
  items?: readonly PublicNavItem[] | undefined
  /** Header call to action. Defaults to DEFAULT_NAV_ACTION. */
  action?: PublicNavItem | undefined
}

/**
 * Public site header (reference `.static-nav`, RESPONSIVE-BEHAVIOR "Public header"). Server Component, sticky, hairline
 * bottom border (no shadow card), translucent parchment, top safe-area inset.
 *  - 960px and up: brand left, primary nav centred, "Log in" and the primary action right.
 *  - below 960px: compact brand (roundel only below 480px), the primary action stays in the bar, and a 44px "Menu"
 *    trigger opens the Sheet with the full nav, the action and "Log in".
 * Client code: PublicNavLinks (desktop `aria-current`) and PublicMobileMenu (the Sheet). Everything else is static HTML,
 * and every link is in the prerendered markup.
 */
export function PublicNav({ items, action = DEFAULT_NAV_ACTION }: PublicNavProps) {
  const links = usableLinks(items)
  const navItems = links.length > 0 ? links : FALLBACK_NAV_ITEMS
  const cta = classifyHref(action.href as Route) === 'unsafe' ? DEFAULT_NAV_ACTION : action

  return (
    <header className="sticky top-0 z-header border-b border-line bg-parchment/95 pt-safe backdrop-blur-lg">
      <Shell className="flex min-h-header items-center gap-3 md:gap-8">
        <div className="flex min-w-0 md:flex-1">
          <BrandMark compact />
        </div>
        <PublicNavLinks items={navItems} label={NAV_LABEL} />
        <div className="ml-auto flex min-w-0 items-center justify-end gap-2 md:ml-0 md:flex-1 md:gap-4">
          <PublicAccountLink />
          <Button href={cta.href as Route} icon={<ArrowRight size="sm" />} iconPosition="end" className="shrink">
            {cta.label}
          </Button>
          <PublicMobileMenu items={navItems} action={cta} label={NAV_LABEL} />
        </div>
      </Shell>
    </header>
  )
}
