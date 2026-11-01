'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useCreatePreviewLink } from '@/features/cms/hooks/usePreviewLink'
import { copyFor } from '@/lib/api/error-copy'
import type { SiteSection } from '@/lib/api/types/site-content'

/**
 * "Preview draft" (PV01, CMS-F7): asks for a single-use link and opens it in a new tab. Disabled, with the reason shown,
 * when there is no saved draft or edits are unsaved. The preview works on the deployed site only.
 */
export function PreviewButton({
  sectionKey,
  hasSavedDraft,
  dirty,
}: {
  sectionKey: SiteSection
  hasSavedDraft: boolean
  dirty: boolean
}) {
  const create = useCreatePreviewLink()
  const [blocked, setBlocked] = useState<string | null>(null)
  const reason = dirty
    ? 'Save your changes to preview them.'
    : hasSavedDraft
      ? undefined
      : 'There is no draft to preview. Save a change first.'
  const open = () => {
    setBlocked(null)
    create.mutateAsync({ kind: 'site', id: sectionKey }).then(
      (link) => {
        // Opened after an async call, so a popup blocker may stop it; then offer the link instead.
        const win = window.open(link.url, '_blank', 'noopener,noreferrer')
        if (win === null) setBlocked(link.url)
      },
      () => undefined, // the error shows from create.error
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={reason !== undefined}
          aria-describedby={reason === undefined ? undefined : 'preview-reason'}
          loading={create.isPending}
          loadingLabel="Creating preview link"
          onClick={open}
        >
          Preview draft
        </Button>
      </div>
      {reason === undefined ? null : (
        <p id="preview-reason" className="text-label text-muted">
          {reason}
        </p>
      )}
      {create.isError ? (
        <p role="alert" className="text-sm font-semibold text-danger-ink">
          {copyFor(create.error, { action: 'create the preview link' }).body}
        </p>
      ) : null}
      {blocked === null ? null : (
        <p role="status" className="text-label">
          Your browser blocked the new tab.{' '}
          <a href={blocked} target="_blank" rel="noopener noreferrer" className="underline">
            Open the preview
          </a>
        </p>
      )}
    </div>
  )
}
