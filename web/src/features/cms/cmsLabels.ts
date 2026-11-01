import type { LegalPage } from '@/lib/api/types/legal-sitemap'
import type { SiteSection } from '@/lib/api/types/site-content'

export type CmsSelection = { kind: 'section'; key: SiteSection } | { kind: 'legal'; key: LegalPage }

export const SECTION_LABELS: Record<SiteSection, string> = {
  home: 'Home page',
  community: 'Community page',
  nav: 'Navigation',
  footer: 'Footer',
  meta: 'Page metadata',
}

export const LEGAL_LABELS: Record<LegalPage, string> = {
  privacy: 'Privacy policy',
  terms: 'Terms of use',
  'refund-policy': 'Refund policy',
}

export function selectionLabel(selection: CmsSelection): string {
  return selection.kind === 'section' ? SECTION_LABELS[selection.key] : LEGAL_LABELS[selection.key]
}

export function sameSelection(a: CmsSelection | null, b: CmsSelection): boolean {
  return a !== null && a.kind === b.kind && a.key === b.key
}
