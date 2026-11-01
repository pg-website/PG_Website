'use client'

import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Banner } from '@/components/ui/feedback/Banner'
import { Field } from '@/components/ui/form/Field'
import { Input } from '@/components/ui/form/Input'
import { Switch } from '@/components/ui/form/Switch'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useUploadFlow } from '@/features/admin/media/useUploadFlow'
import { MediaPickerDialog } from '@/features/cms/MediaPickerDialog'
import { altLabel } from '@/features/cms/picker/altLabel'
import {
  MAX_ASSET_LIST_ITEMS,
  MEDIA_INTERVAL_DEFAULT,
  MEDIA_INTERVAL_MAX,
  MEDIA_INTERVAL_MIN,
  type MediaAssetSummary,
} from '@/lib/api/types/admin/media'

// PLAN-010 TASK-1011: ordered image list for events, stories and site sections. Picks from the asset library, uploads
// inline, reorders (drag, or Earlier / Later buttons for keyboard and touch), removes. The first image is the cover.
// One image is static, two or more is a carousel (derived by the server); autoplay is off by default.

export interface AssetListAutoplay {
  autoplay: boolean
  intervalMs: number
  onChange: (next: { autoplay: boolean; intervalMs: number }) => void
}

export interface AssetListFieldProps {
  /** Visible group label. */
  label: string
  hint?: string
  /** Ordered asset ids. */
  value: readonly string[]
  /** Summaries from the last server read; ids without one show a neutral tile until the next read. */
  assets?: readonly MediaAssetSummary[]
  /** New ordered ids, plus the summaries known for them (from the server read or just picked/uploaded). */
  onChange: (ids: string[], summaries: MediaAssetSummary[]) => void
  /** Show the autoplay toggle (only rendered with 2 or more images). */
  autoplay?: AssetListAutoplay
  disabled?: boolean
  error?: string
  /** Default 50 (server cap). */
  max?: number
}

type Summary = Pick<MediaAssetSummary, 'id' | 'src' | 'alt' | 'decorative'>

const isMissingAlt = (item: Summary | undefined): boolean =>
  item !== undefined && !item.decorative && (item.alt === null || item.alt === '')

export function AssetListField({
  label,
  hint,
  value,
  assets = [],
  onChange,
  autoplay,
  disabled = false,
  error,
  max = MAX_ASSET_LIST_ITEMS,
}: AssetListFieldProps) {
  const [open, setOpen] = useState(false)
  const [known, setKnown] = useState<ReadonlyMap<string, Summary>>(new Map())
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [announce, setAnnounce] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const upload = useUploadFlow()

  const lookup = new Map<string, Summary>(assets.map((a) => [a.id, a]))
  known.forEach((v, k) => lookup.set(k, v))
  const atCap = value.length >= max

  const emit = (ids: string[], extra?: Summary) => {
    const table = new Map(lookup)
    if (extra) table.set(extra.id, extra)
    const summaries = ids.flatMap((id) => {
      const item = table.get(id)
      return item === undefined ? [] : [{ width: 1, height: 1, focal: { x: 0.5, y: 0.5 }, ...item }]
    })
    onChange(ids, summaries)
  }
  const add = (asset: Summary) => {
    setKnown((prev) => new Map(prev).set(asset.id, asset))
    if (!value.includes(asset.id) && value.length < max) emit([...value, asset.id], asset)
  }
  const toggle = (asset: Summary) => {
    if (value.includes(asset.id)) emit(value.filter((id) => id !== asset.id))
    else add(asset)
  }
  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length || from === to) return
    const next = [...value]
    const [item] = next.splice(from, 1)
    if (item === undefined) return
    next.splice(to, 0, item)
    emit(next)
    setAnnounce(`Image moved to position ${to + 1} of ${next.length}.`)
  }
  const remove = (index: number) => {
    emit(value.filter((_, i) => i !== index))
    setAnnounce('Image removed.')
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined || atCap) return
    const asset = await upload.upload(file)
    if (asset !== null) add({ id: asset.id, src: asset.src, alt: asset.alt, decorative: asset.decorative })
  }

  const onDrop = (event: DragEvent<HTMLLIElement>, to: number) => {
    event.preventDefault()
    if (dragFrom !== null) move(dragFrom, to)
    setDragFrom(null)
  }

  const uploading = upload.status === 'uploading' || upload.status === 'completing'
  const anyMissingAlt = value.some((id) => isMissingAlt(lookup.get(id)))

  return (
    <Field label={label} hint={hint} error={error} group>
      <div className="flex min-w-0 flex-col gap-3">
        {value.length === 0 ? (
          <p className="font-ui text-sm text-muted">No images yet. The page shows its placeholder.</p>
        ) : (
          <ol className="grid min-w-0 gap-2" aria-label={`${label}, in display order`}>
            {value.map((id, index) => {
              const item = lookup.get(id)
              return (
                <li
                  key={id}
                  draggable={!disabled}
                  onDragStart={() => {
                    setDragFrom(index)
                  }}
                  onDragOver={(event) => {
                    if (dragFrom !== null) event.preventDefault()
                  }}
                  onDrop={(event) => {
                    onDrop(event, index)
                  }}
                  onDragEnd={() => {
                    setDragFrom(null)
                  }}
                  className={[
                    'flex min-w-0 flex-wrap items-center gap-3 rounded-public border bg-parchment-soft p-2',
                    dragFrom === index ? 'border-copper' : 'border-line-admin',
                  ].join(' ')}
                >
                  <span className="h-16 w-16 shrink-0 overflow-hidden rounded-public bg-sand">
                    {item === undefined ? null : (
                      // eslint-disable-next-line @next/next/no-img-element -- admin thumbnails, same as the media library
                      <img
                        src={item.src}
                        alt={item.decorative ? '' : (item.alt ?? '')}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-ui text-sm wrap-break-word text-ink">
                      {item === undefined ? 'Image' : altLabel(item)}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {index === 0 ? <StatusBadge tone="copper">Cover</StatusBadge> : null}
                      {isMissingAlt(item) ? <StatusBadge tone="warning">Alt text missing</StatusBadge> : null}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabled || index === 0}
                      aria-label={`Move image ${index + 1} earlier`}
                      onClick={() => {
                        move(index, index - 1)
                      }}
                    >
                      Earlier
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabled || index === value.length - 1}
                      aria-label={`Move image ${index + 1} later`}
                      onClick={() => {
                        move(index, index + 1)
                      }}
                    >
                      Later
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={disabled}
                      aria-label={`Remove image ${index + 1}`}
                      onClick={() => {
                        remove(index)
                      }}
                    >
                      Remove
                    </Button>
                  </span>
                </li>
              )
            })}
          </ol>
        )}

        {anyMissingAlt ? (
          <p className="font-ui text-sm text-warning-ink">
            Add alt text (or mark the image decorative) in the Media Library before publishing.
          </p>
        ) : null}
        {atCap ? <p className="font-ui text-sm text-muted">Maximum of {max} images reached.</p> : null}
        {uploading ? <Banner tone="info">Uploading… {upload.progress ?? 0}%</Banner> : null}
        {upload.status === 'error' && upload.error ? <Banner tone="danger">{upload.error}</Banner> : null}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || atCap}
            onClick={() => {
              setOpen(true)
            }}
          >
            {value.length === 0 ? 'Choose images' : 'Add from library'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || atCap}
            loading={uploading}
            loadingLabel="Uploading image"
            onClick={() => fileRef.current?.click()}
          >
            Upload image
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => void onFile(event)}
          />
        </div>

        {autoplay !== undefined && value.length >= 2 ? (
          <div className="grid min-w-0 gap-3">
            <Switch
              label="Autoplay"
              description="Advance through the images automatically. Off by default."
              checked={autoplay.autoplay}
              disabled={disabled}
              onCheckedChange={(checked) => {
                autoplay.onChange({ autoplay: checked, intervalMs: autoplay.intervalMs || MEDIA_INTERVAL_DEFAULT })
              }}
            />
            {autoplay.autoplay ? (
              <Field
                label="Seconds per image"
                hint={`Between ${MEDIA_INTERVAL_MIN / 1000} and ${MEDIA_INTERVAL_MAX / 1000} seconds.`}
              >
                <Input
                  type="number"
                  min={MEDIA_INTERVAL_MIN / 1000}
                  max={MEDIA_INTERVAL_MAX / 1000}
                  step={1}
                  disabled={disabled}
                  value={Math.round(autoplay.intervalMs / 1000)}
                  onChange={(event) => {
                    const seconds = Number(event.target.value)
                    if (!Number.isFinite(seconds)) return
                    const ms = Math.min(MEDIA_INTERVAL_MAX, Math.max(MEDIA_INTERVAL_MIN, Math.round(seconds) * 1000))
                    autoplay.onChange({ autoplay: true, intervalMs: ms })
                  }}
                />
              </Field>
            ) : null}
          </div>
        ) : null}

        <p className="sr-only" role="status" aria-live="polite">
          {announce}
        </p>
      </div>

      <MediaPickerDialog
        mode="assets"
        open={open}
        onOpenChange={setOpen}
        selectedIds={new Set(value)}
        onToggle={toggle}
      />
    </Field>
  )
}
