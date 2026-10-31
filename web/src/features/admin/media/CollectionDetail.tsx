'use client'

import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banner } from '@/components/ui/feedback/Banner'
import { QueryView } from '@/components/ui/feedback/QueryView'
import { Skeleton } from '@/components/ui/feedback/Skeleton'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/form/Field'
import { Input } from '@/components/ui/form/Input'
import { Select } from '@/components/ui/form/Select'
import { Switch } from '@/components/ui/form/Switch'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import type { MediaAssetDto, MediaAssetSummary, MediaCollectionAdminDto } from '@/lib/api/types/admin/media'
import { MAX_COLLECTION_ITEMS } from '@/lib/api/types/admin/media'
import { copyFor } from '@/lib/api/error-copy'
import { isAbortError } from '@/lib/api/errors'
import { useToast } from '@/components/ui/feedback/useToast'
import { adminMediaAssetsQuery, adminMediaCollectionQuery } from '@/lib/query/query-options/admin'

// ---- inline asset picker used when adding assets to a collection ----

interface AssetPickerProps {
  alreadyAdded: Set<string>
  onPick: (asset: MediaAssetDto) => void
  onClose: () => void
}

function AssetPicker({ alreadyAdded, onPick, onClose }: AssetPickerProps) {
  const api = useApi().admin
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearch = (value: string) => {
    setQ(value)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setDebouncedQ(value.trim()), 300)
  }

  const query = useQuery({
    ...adminMediaAssetsQuery(api, { q: debouncedQ || undefined, pageSize: 30 }),
    placeholderData: keepPreviousData,
  })

  return (
    <div className="border border-line-admin bg-admin-panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-ui text-sm font-semibold text-ink">Pick assets to add</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close picker"
          className="text-muted hover:text-ink"
        >
          ✕
        </button>
      </div>
      <Input
        type="search"
        value={q}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Search assets…"
        className="mb-3"
        autoComplete="off"
      />
      {query.isPending ? (
        <div className="grid grid-cols-4 gap-1.5">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} shape="block" className="aspect-square w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="text-sm text-danger-ink">Failed to load assets.</p>
      ) : (
        <div className="max-h-60 overflow-y-auto">
          <div className="grid grid-cols-4 gap-1.5">
            {(query.data?.items ?? []).map((asset) => {
              const added = alreadyAdded.has(asset.id)
              return (
                <button
                  key={asset.id}
                  type="button"
                  disabled={added}
                  onClick={() => onPick(asset)}
                  className={[
                    'group relative aspect-square overflow-hidden rounded-sm border-2 transition-colors',
                    added
                      ? 'cursor-not-allowed border-copper opacity-60'
                      : 'border-transparent hover:border-copper focus-visible:border-copper',
                  ].join(' ')}
                  title={added ? 'Already in collection' : (asset.alt ?? asset.id)}
                >
                  <img
                    src={asset.src}
                    alt={asset.alt ?? ''}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  {added && (
                    <span className="absolute inset-0 flex items-center justify-center bg-copper/20 text-[0.6rem] font-bold text-copper">
                      ✓
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {(query.data?.items.length ?? 0) === 0 && (
            <p className="py-4 text-center text-sm text-muted">No assets found.</p>
          )}
        </div>
      )}
    </div>
  )
}

interface CollectionDetailProps {
  collectionId: number | string
  onClose: () => void
}

const MODE_OPTIONS = [
  { value: 'static', label: 'Static' },
  { value: 'carousel', label: 'Carousel' },
]

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton shape="line" />
      <Skeleton shape="line" />
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} shape="block" className="aspect-square w-full" />
        ))}
      </div>
    </div>
  )
}

interface DetailFormProps {
  collection: MediaCollectionAdminDto
  onClose: () => void
}

function DetailForm({ collection, onClose }: DetailFormProps) {
  const api = useApi().admin
  const queryClient = useQueryClient()
  const toast = useToast()

  const [name, setName] = useState(collection.name)
  const [mode, setMode] = useState<'static' | 'carousel'>(collection.mode)
  const [autoplay, setAutoplay] = useState(collection.autoplay)
  const [intervalMs, setIntervalMs] = useState(collection.intervalMs)
  const [localItems, setLocalItems] = useState<MediaAssetSummary[]>(collection.items)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [versionConflict, setVersionConflict] = useState(false)

  // Re-init when collection changes identity
  useEffect(() => {
    setName(collection.name)
    setMode(collection.mode)
    setAutoplay(collection.autoplay)
    setIntervalMs(collection.intervalMs)
    setLocalItems(collection.items)
    setSaveError(null)
    setVersionConflict(false)
  }, [collection.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const removeItem = (id: string) => {
    setLocalItems((prev) => prev.filter((i) => i.id !== id))
  }

  const addItem = (asset: MediaAssetDto) => {
    if (localItems.length >= MAX_COLLECTION_ITEMS) return
    if (localItems.some((i) => i.id === asset.id)) return
    setLocalItems((prev) => [
      ...prev,
      {
        id: asset.id,
        src: asset.src,
        width: asset.width,
        height: asset.height,
        alt: asset.alt,
        decorative: asset.decorative,
        focal: asset.focal,
      },
    ])
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    setVersionConflict(false)
    try {
      await api.media.updateCollection(String(collection.id), {
        version: collection.version,
        name,
        mode,
        autoplay,
        intervalMs,
        items: localItems.map((i) => ({ assetId: i.id })),
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'media', 'collections', String(collection.id)] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'media', 'collections'] }),
      ])
      toast.success('Collection saved')
    } catch (err: unknown) {
      if (isAbortError(err)) return
      // Detect VERSION_CONFLICT
      const isConflict =
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'VERSION_CONFLICT'
      if (isConflict) {
        setVersionConflict(true)
        await queryClient.refetchQueries({
          queryKey: ['admin', 'media', 'collections', String(collection.id)],
        })
      } else {
        setSaveError(err)
      }
    } finally {
      setSaving(false)
    }
  }

  const errorCopy = saveError === null ? null : copyFor(saveError, { action: 'save collection' })

  return (
    <aside
      aria-label={`Edit collection: ${collection.name}`}
      className="flex flex-col gap-4 rounded-public border border-line-admin bg-parchment-soft p-4"
    >
      {/* Header */}
      <div className="flex min-w-0 items-start justify-between gap-2">
        <h2 className="min-w-0 truncate font-ui font-semibold text-ink">{collection.name}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close collection editor"
          className="min-h-tap min-w-tap shrink-0 rounded-public text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      {versionConflict && (
        <Banner tone="warning">
          This collection was updated elsewhere. The form has been refreshed — review and save again.
        </Banner>
      )}

      {errorCopy !== null && (
        <Banner tone="danger" title={errorCopy.title} live="alert">
          {errorCopy.body}
        </Banner>
      )}

      {/* Settings */}
      <Field label="Name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />
      </Field>

      <Field label="Mode">
        <Select
          options={MODE_OPTIONS}
          value={mode}
          onValueChange={(v) => setMode(v as 'static' | 'carousel')}
        />
      </Field>

      {mode === 'carousel' && (
        <>
          <Switch
            label="Autoplay"
            checked={autoplay}
            onCheckedChange={setAutoplay}
          />
          <Field label="Interval (ms)">
            <Input
              type="number"
              value={String(intervalMs)}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                if (!isNaN(n)) setIntervalMs(Math.min(60000, Math.max(2000, n)))
              }}
              min={2000}
              max={60000}
            />
          </Field>
        </>
      )}

      {/* Items */}
      <div>
        <p className="mb-2 font-ui text-sm font-semibold text-ink">
          Items ({localItems.length}/{MAX_COLLECTION_ITEMS})
        </p>
        {localItems.length === 0 ? (
          <p className="text-sm text-muted">No items. Add an asset ID below.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {localItems.map((item) => (
              <div key={item.id} className="group relative aspect-square overflow-hidden rounded-sm bg-sand">
                {item.src ? (
                  <img
                    src={item.src}
                    alt={item.alt ?? ''}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <span className="break-all px-1 text-center font-mono text-[0.55rem] text-muted">{item.id}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  aria-label={`Remove asset ${item.alt ?? item.id}`}
                  className="absolute inset-0 flex items-center justify-center bg-ink/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  <span className="rounded-full bg-danger px-2 py-0.5 font-ui text-xs text-white">Remove</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add assets — inline picker */}
      {localItems.length < MAX_COLLECTION_ITEMS && (
        pickerOpen ? (
          <AssetPicker
            alreadyAdded={new Set(localItems.map((i) => i.id))}
            onPick={(asset) => addItem(asset)}
            onClose={() => setPickerOpen(false)}
          />
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
            + Add assets
          </Button>
        )
      )}

      <Button onClick={() => void handleSave()} loading={saving}>
        Save collection
      </Button>
    </aside>
  )
}

export function CollectionDetail({ collectionId, onClose }: CollectionDetailProps) {
  const api = useApi().admin
  const query = useQuery(adminMediaCollectionQuery(api, String(collectionId)))

  return (
    <QueryView
      query={query}
      loadingLabel="Loading collection"
      skeleton={<DetailSkeleton />}
      errorAction="load collection"
    >
      {(data) => <DetailForm collection={data} onClose={onClose} />}
    </QueryView>
  )
}
