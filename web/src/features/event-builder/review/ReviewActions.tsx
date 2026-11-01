'use client'

import { useState } from 'react'
import { ConfirmAction } from '@/components/admin/ConfirmAction'
import { Banner } from '@/components/ui/feedback/Banner'
import { useToast } from '@/components/ui/feedback/useToast'
import { Button } from '@/components/ui/Button'
import { Heading } from '@/components/ui/Heading'
import { useBuilderSelector, useBuilderStore } from '@/features/event-builder/context'
import { hasPending } from '@/features/event-builder/patch'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { copyFor } from '@/lib/api/error-copy'
import { isAbortError } from '@/lib/api/errors'

const LIVE_STATUSES: readonly string[] = ['published', 'registration_open']

/**
 * Review step actions. Publish (E07) needs the server's readiness and goes through ConfirmAction (Idempotency-Key per
 * intent, step-up handled by the admin adapter). A refusal re-reads the draft so the server's `readiness.blockers` (listed
 * above, each linking to its step) are current. Unpublish (E08) returns the event to draft. The preview link (PV01) opens
 * the saved draft on the public site through /api/draft.
 */
export function ReviewActions() {
  const api = useApi().admin
  const store = useBuilderStore()
  const toast = useToast()
  const id = useBuilderSelector((state) => state.server.id)
  const status = useBuilderSelector((state) => state.server.status)
  const ready = useBuilderSelector((state) => state.server.readiness.ready)
  const dirty = useBuilderSelector((state) => hasPending(state.pending) || state.save === 'saving')
  const hasSlug = useBuilderSelector((state) => (state.server.basics.slug.value ?? '') !== '')
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<unknown>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const reread = async (): Promise<void> => {
    store.adoptServer(await api.events.getEvent(id))
  }

  const openPreview = async (): Promise<void> => {
    setPreviewing(true)
    setPreviewError(null)
    setPreviewUrl(null)
    try {
      await store.flush()
      const link = await api.preview.createPreviewLink({ kind: 'event', id })
      const opened = window.open(link.url, '_blank')
      if (opened === null) setPreviewUrl(link.url)
      else opened.opener = null
    } catch (error) {
      if (!isAbortError(error)) setPreviewError(error)
    } finally {
      setPreviewing(false)
    }
  }

  const previewCopy = previewError === null ? null : copyFor(previewError, { action: 'open the preview' })
  return (
    <section aria-labelledby="review-actions" className="grid min-w-0 gap-3">
      <Heading level={2} size="card" id="review-actions">
        Preview and publish
      </Heading>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          loading={previewing}
          loadingLabel="Creating preview link"
          disabled={!hasSlug}
          onClick={() => void openPreview()}
        >
          Open preview on the site
        </Button>

        {status === 'draft' ? (
          <ConfirmAction
            renderTrigger={(open) => (
              <Button onClick={open} disabled={!ready || dirty}>
                Publish
              </Button>
            )}
            title="Publish this event?"
            consequence="The event goes live on the public site and the address (slug) is locked from now on."
            confirmLabel="Publish event"
            actionLabel="publish this event"
            onConfirm={async (key) => {
              try {
                await store.flush()
                await api.events.publishEvent(id, key)
              } catch (error) {
                await reread().catch(() => undefined) // a refusal changes what the server lists as blockers
                throw error
              }
              await reread()
            }}
            onDone={() => {
              toast.success('Event published')
            }}
          />
        ) : null}

        {LIVE_STATUSES.includes(status) ? (
          <ConfirmAction
            renderTrigger={(open) => (
              <Button variant="secondary" onClick={open}>
                Unpublish
              </Button>
            )}
            title="Unpublish this event?"
            consequence="The event returns to draft and disappears from the public site. The address (slug) stays locked."
            confirmLabel="Unpublish"
            actionLabel="unpublish this event"
            onConfirm={async (key) => {
              await api.events.unpublishEvent(id, { idempotencyKey: key })
              await reread()
            }}
            onDone={() => {
              toast.success('Event unpublished')
            }}
          />
        ) : null}
      </div>
      {hasSlug ? null : (
        <p className="m-0 text-sm text-muted">Set the event address (step 1) and save to open a preview.</p>
      )}
      {status === 'draft' && !ready ? (
        <p className="m-0 text-sm text-muted">Publishing is available once every item above is fixed.</p>
      ) : null}
      {status === 'draft' && ready && dirty ? (
        <p className="m-0 text-sm text-muted">Saving your changes first.</p>
      ) : null}
      {previewCopy === null ? null : (
        <Banner tone="danger" title={previewCopy.title} live="alert">
          {previewCopy.body}
        </Banner>
      )}
      {previewUrl === null ? null : (
        <p className="m-0 text-sm">
          Your browser blocked the new tab.{' '}
          <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="underline">
            Open the preview
          </a>{' '}
          (the link works once and expires in a few minutes).
        </p>
      )}
    </section>
  )
}
