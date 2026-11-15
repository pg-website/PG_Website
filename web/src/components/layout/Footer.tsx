import type { Route } from 'next'
import { BrandMark } from '@/components/layout/BrandMark'
import type { PublicNavItem } from '@/components/layout/PublicNavLinks'
import { Shell } from '@/components/layout/Shell'
import { ActionLink } from '@/components/ui/ActionLink'
import { classifyHref } from '@/components/ui/linkHref'
import { toIstParts } from '@/lib/format/instant'

/** Footer tagline when the CMS `footer` section has none (reference screen 01). */
export const FALLBACK_TAGLINE = 'Good games. Better company.'

/** Used when the CMS `footer` section has no usable links. Legal pages are always reachable (FEAT-001, payments). */
export const FALLBACK_FOOTER_LINKS: readonly PublicNavItem[] = [
  { label: 'Play', href: '/play' },
  { label: 'Community', href: '/community' },
  // { label: 'Stories', href: '/stories' }, // hidden for now
  { label: 'Past events', href: '/past-events' },
  { label: 'Contact', href: '/contact' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'Refund policy', href: '/refund-policy' },
]

/** Site paths that belong in the legal row, whatever group the CMS puts them in. */
const LEGAL_PATHS = new Set(['/privacy', '/terms', '/refund-policy'])
const REQUIRED_LEGAL: readonly PublicNavItem[] = FALLBACK_FOOTER_LINKS.filter((link) => LEGAL_PATHS.has(link.href))
const CONTACT_LINK: PublicNavItem = { label: 'Contact', href: '/contact' }

/**
 * Copyright year in IST, fixed when the server module loads (build, or a fresh server instance for ISR). Module scope,
 * not render: render stays pure, the value is a constant (no mutable module state) and the browser never computes it.
 */
const COPYRIGHT_YEAR = toIstParts(Date.now()).year

function usable(items: readonly PublicNavItem[] | undefined): PublicNavItem[] {
  return (items ?? []).filter((item) => item.label.trim() !== '' && classifyHref(item.href as Route) !== 'unsafe')
}

function pathOf(href: string): string {
  return (href.split(/[?#]/)[0] ?? '').replace(/\/+$/, '') || '/'
}

/**
 * Splits the CMS links into site links and legal links. Privacy, Terms and Refund policy are added when the CMS omits
 * them (they must be one click from every public page), and Contact is added to the site group when missing.
 */
function groupLinks(links: readonly PublicNavItem[]) {
  const site = links.filter((link) => !LEGAL_PATHS.has(pathOf(link.href)))
  const legal = links.filter((link) => LEGAL_PATHS.has(pathOf(link.href)))
  for (const required of REQUIRED_LEGAL) {
    if (!legal.some((link) => pathOf(link.href) === required.href)) legal.push(required)
  }
  if (!site.some((link) => pathOf(link.href) === CONTACT_LINK.href)) site.push(CONTACT_LINK)
  return { site, legal }
}

interface FooterProps {
  /** `footer.content.tagline`. */
  tagline?: string | undefined
  /** `footer.content.links`. Missing or empty falls back to FALLBACK_FOOTER_LINKS. */
  links?: readonly PublicNavItem[] | undefined
  /** `footer.content.social` (absolute http(s) links only after filtering). */
  social?: readonly PublicNavItem[] | undefined
  /** `footer.content.legalNote` (registered name, GST line). */
  legalNote?: string | null | undefined
}

const LINK_CLASS =
  'tap inline-flex max-w-full text-sm wrap-break-word text-parchment underline-offset-4 hover:underline'

function renderLinkList(items: readonly PublicNavItem[], label: string) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-x-6 gap-y-3">
        {items.map((item) => (
          <li key={`${item.href}-${item.label}`}>
            {/* Link-dense surface at the end of the page: prefetch on intent only (PrefetchLink). */}
            <ActionLink href={item.href as Route} className={LINK_CLASS} prefetchOnIntent>
              {item.label}
            </ActionLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/**
 * Public site footer (reference `.static-footer`): forest-dark band with the brand, the tagline, site links, social
 * links, legal links, the optional legal note and the copyright. Server Component; the year is computed in IST on the
 * server (COPYRIGHT_YEAR), never in the browser, so there is no hydration mismatch. Bottom
 * safe-area inset for phones with a home indicator. Links come from CMS data and pass the same link policy as
 * ActionLink (unsafe hrefs are dropped before render).
 */
export function Footer({ tagline, links, social, legalNote }: FooterProps) {
  const cmsLinks = usable(links)
  const { site, legal } = groupLinks(cmsLinks.length > 0 ? cmsLinks : FALLBACK_FOOTER_LINKS)
  const socialLinks = usable(social).filter((item) => classifyHref(item.href as Route) === 'external')
  const line = tagline?.trim() ? tagline : FALLBACK_TAGLINE

  return (
    <footer data-surface="dark" className="bg-forest-dark pb-safe text-parchment">
      <Shell className="flex flex-col gap-8 py-12">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-3">
            <BrandMark tone="dark" />
            <p className="max-w-prose text-parchment-muted">{line}</p>
          </div>
          <div className="flex flex-col gap-6 md:items-end">
            {renderLinkList(site, 'Site')}
            {socialLinks.length > 0 ? renderLinkList(socialLinks, 'Social') : null}
          </div>
        </div>
        <div className="flex flex-col gap-4 border-t border-line-light pt-4 sm:flex-row sm:items-center sm:justify-between">
          {renderLinkList(legal, 'Legal')}
          <div className="flex flex-col gap-1 font-mono text-label text-parchment-muted sm:items-end">
            {legalNote?.trim() ? <p>{legalNote}</p> : null}
            <p>
              <span aria-hidden="true">&copy;</span>
              <span className="sr-only">Copyright</span> {COPYRIGHT_YEAR} Pawn&apos;s Gambit
            </p>
          </div>
        </div>
      </Shell>
    </footer>
  )
}
