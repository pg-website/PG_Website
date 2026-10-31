'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ConfirmAction } from '@/components/admin/ConfirmAction'
import { Button } from '@/components/ui/Button'
import { Banner } from '@/components/ui/feedback/Banner'
import { useToast } from '@/components/ui/feedback/useToast'
import { Field } from '@/components/ui/form/Field'
import { Input } from '@/components/ui/form/Input'
import { Select } from '@/components/ui/form/Select'
import { Switch } from '@/components/ui/form/Switch'
import { Textarea } from '@/components/ui/form/Textarea'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import type { MediaAssetDto, MediaAssetStatus } from '@/lib/api/types/admin/media'
import { MEDIA_ASSET_STATUSES } from '@/lib/api/types/admin/media'
import { copyFor } from '@/lib/api/error-copy'
import { isAbortError } from '@/lib/api/errors'

interface AssetEditPanelProps {
  asset: MediaAssetDto
  onClose: () => void
  onSaved: (updated: MediaAssetDto) => void
}

const STATUS_OPTIONS = MEDIA_ASSET_STATUSES.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}))

function filenameFromSrc(src: string): string {
  return src.split('/').pop() ?? src
}

export function AssetEditPanel({ asset, onClose, onSaved }: AssetEditPanelProps) {
  const api = useApi().admin
  const queryClient = useQueryClient()
  const toast = useToast()

  const [alt, setAlt] = useState('')
  const [decorative, setDecorative] = useState(false)
  const [credit, setCredit] = useState('')
  const [status, setStatus] = useState<MediaAssetStatus>('draft')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [publishWarning, setPublishWarning] = useState(false)

  // Initialise form when asset changes
  useEffect(() => {
    setAlt(asset.alt ?? '')
    setDecorative(asset.decorative)
    setCredit(asset.credit ?? '')
    setStatus(asset.status)
    setSaveError(null)
    setPublishWarning(false)
  }, [asset.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDecorativeChange = (checked: boolean) => {
    setDecorative(checked)
    if (checked) setAlt('')
  }

  const handleSave = async () => {
    // Warn before publishing without alt/decorative
    if (status === 'published' && !decorative && !alt.trim()) {
      setPublishWarning(true)
      return
    }
    setPublishWarning(false)
    setSaving(true)
    setSaveError(null)
    try {
      const result = await api.media.updateAsset(asset.id, {
        version: asset.version,
        alt: decorative ? undefined : alt.trim() || undefined,
        decorative,
        credit: credit.trim() || null,
        status,
      })
      onSaved(result)
      toast.success('Asset saved')
    } catch (err: unknown) {
      if (!isAbortError(err)) setSaveError(err)
    } finally {
      setSaving(false)
    }
  }

  const filename = filenameFromSrc(asset.src)
  const errorCopy = saveError === null ? null : copyFor(saveError, { action: 'save asset' })

  return (
    <aside
      aria-label="Edit asset"
      className="flex min-w-0 flex-col gap-4 rounded-public border border-line-admin bg-parchment-soft p-4"
    >
      {/* Header */}
      <div className="flex min-w-0 items-start justify-between gap-2">
        <h2 className="min-w-0 truncate font-mono text-sm text-muted" title={filename}>
          {filename}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close asset editor"
          className="min-h-tap min-w-tap shrink-0 rounded-public text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      {/* Preview */}
      <img
        src={asset.src}
        alt={asset.alt ?? ''}
        className="w-full max-h-48 rounded-public object-contain bg-parchment-soft"
      />

      {/* Usage */}
      <p className="text-sm text-muted">
        {asset.usageCount} usage{asset.usageCount !== 1 ? 's' : ''}
      </p>

      {/* Alt */}
      <Field label="Alt text">
        <Textarea
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          rows={3}
          maxLength={300}
          disabled={decorative}
          placeholder={decorative ? 'Decorative image — no alt needed' : 'Describe the image…'}
        />
      </Field>

      {/* Decorative */}
      <Switch
        label="Decorative image"
        description="Skip alt text for purely decorative images (icons, dividers)."
        checked={decorative}
        onCheckedChange={handleDecorativeChange}
      />

      {/* Credit */}
      <Field label="Credit">
        <Input
          value={credit}
          onChange={(e) => setCredit(e.target.value)}
          maxLength={200}
          placeholder="Photographer or source"
        />
      </Field>

      {/* Status */}
      <Field label="Status">
        <Select
          options={STATUS_OPTIONS}
          value={status}
          onValueChange={(v) => setStatus(v as MediaAssetStatus)}
        />
      </Field>

      {publishWarning && (
        <Banner tone="warning">
          Add alt text or mark as decorative before publishing.
        </Banner>
      )}

      {errorCopy !== null && (
        <Banner tone="danger" title={errorCopy.title} live="alert">
          {errorCopy.body}
        </Banner>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void handleSave()} loading={saving}>
          Save
        </Button>

        {asset.usageCount === 0 && (
          <ConfirmAction
            renderTrigger={(open) => (
              <button
                type="button"
                onClick={open}
                className="inline-flex min-h-tap items-center justify-center rounded-public border border-danger bg-transparent px-4 py-2 font-ui text-sm font-semibold text-danger transition-colors hover:bg-danger hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Delete
              </button>
            )}
            title="Delete this asset?"
            consequence={`"${filename}" will be permanently deleted. This cannot be undone.`}
            confirmLabel="Delete asset"
            destructive
            actionLabel="delete this asset"
            onConfirm={async () => {
              await api.media.deleteAsset(asset.id)
            }}
            onDone={() => {
              void queryClient.invalidateQueries({ queryKey: ['admin', 'media', 'assets'] })
              toast.success('Asset deleted')
              onClose()
            }}
          />
        )}
      </div>
    </aside>
  )
}
