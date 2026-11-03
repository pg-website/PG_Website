import type { LegalPage } from '@/lib/api/types/legal-sitemap'

/**
 * Owner approval of the legal wording (FEAT-001 FR-19, OQ-04). The single switch for the "being finalised" notice:
 * while a page is `false` it shows the notice above the content and is served `noindex`, so unapproved wording is
 * never presented as the final policy or indexed. Flip a page to `true` only after the named approver signs it off.
 * Replace with a DTO field if the backend later publishes an approval flag (contract P09 change).
 */
export const LEGAL_WORDING_APPROVED: Readonly<Record<LegalPage, boolean>> = {
  privacy: true,
  terms: true,
  'refund-policy': true,
}

export function isLegalWordingApproved(page: LegalPage): boolean {
  return LEGAL_WORDING_APPROVED[page]
}
