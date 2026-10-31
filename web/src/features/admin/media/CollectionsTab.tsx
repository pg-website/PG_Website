'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Banner } from '@/components/ui/feedback/Banner'
import { QueryView } from '@/components/ui/feedback/QueryView'
import { Skeleton } from '@/components/ui/feedback/Skeleton'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/form/Field'
import { Input } from '@/components/ui/form/Input'
import { Select } from '@/components/ui/form/Select'
import { CollectionDetail } from '@/features/admin/media/CollectionDetail'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import type { MediaCollectionAdminDto } from '@/lib/api/types/admin/media'
import { copyFor } from '@/lib/api/error-copy'
import { isAbortError } from '@/lib/api/errors'
import { formatEventDateTime } from '@/lib/format/date'
import { useToast } from '@/components/ui/feedback/useToast'
import { adminMediaCollectionsQuery } from '@/lib/query/query-options/admin'

const MODE_OPTIONS = [
  { value: 'static', label: 'Static' },
  { value: 'carousel', label: 'Carousel' },
]

const MODE_BADGE_CLASS: Record<string, string> = {
  static: 'bg-sand text-ink',
  carousel: 'bg-forest/10 text-forest',
}

function ModeBadge({ mode }: { mode: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 font-ui text-xs ${MODE_BADGE_CLASS[mode] ?? 'bg-sand text-ink'}`}>
      {mode}
    </span>
  )
}

function CollectionsSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} shape="card" className="h-16 w-full" />
      ))}
    </div>
  )
}

export function CollectionsTab() {
  const api = useApi().admin
  const queryClient = useQueryClient()
  const toast = useToast()

  const [selectedId, setSelectedId] = useState<string | number | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMode, setNewMode] = useState<'static' | 'carousel'>('static')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<unknown>(null)

  const query = useQuery(adminMediaCollectionsQuery(api))

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const result = await api.media.createCollection({
        name: newName.trim(),
        mode: newMode,
        autoplay: false,
        intervalMs: 5000,
        items: [],
      })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'media', 'collections'] })
      setSelectedId(result.id)
      setShowCreateForm(false)
      setNewName('')
      setNewMode('static')
      toast.success('Collection created')
    } catch (err: unknown) {
      if (!isAbortError(err)) setCreateError(err)
    } finally {
      setCreating(false)
    }
  }

  const createErrorCopy = createError === null ? null : copyFor(createError, { action: 'create collection' })

  return (
    <div className="flex flex-col gap-6">
      {/* Create form toggle */}
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          onClick={() => setShowCreateForm((v) => !v)}
        >
          {showCreateForm ? 'Cancel' : 'New collection'}
        </Button>
      </div>

      {showCreateForm && (
        <div className="flex flex-col gap-4 rounded-public border border-line-admin bg-parchment-soft p-4">
          <h2 className="font-ui text-base font-semibold">New collection</h2>
          <Field label="Name">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={120}
              placeholder="e.g. Tournament highlights"
            />
          </Field>
          <Field label="Mode">
            <Select
              options={MODE_OPTIONS}
              value={newMode}
              onValueChange={(v) => setNewMode(v as 'static' | 'carousel')}
            />
          </Field>
          {createErrorCopy !== null && (
            <Banner tone="danger" title={createErrorCopy.title} live="alert">
              {createErrorCopy.body}
            </Banner>
          )}
          <Button onClick={() => void handleCreate()} loading={creating} disabled={!newName.trim()}>
            Create
          </Button>
        </div>
      )}

      {/* Collections list */}
      <QueryView
        query={query}
        loadingLabel="Loading collections"
        skeleton={<CollectionsSkeleton />}
        errorAction="load collections"
      >
        {(data) => {
          if (data.items.length === 0) {
            return <p className="text-sm text-muted">No collections yet. Create one above.</p>
          }
          return (
            <div className={selectedId !== null ? 'grid gap-6 lg:grid-cols-[1fr_360px]' : 'flex flex-col gap-1'}>
              <div className="flex flex-col gap-1">
                {data.items.map((col: MediaCollectionAdminDto) => (
                  <button
                    key={col.id}
                    type="button"
                    aria-pressed={col.id === selectedId}
                    onClick={() => setSelectedId(col.id === selectedId ? null : col.id)}
                    className={[
                      'flex min-h-control items-center gap-3 rounded-public border px-4 py-3 text-left transition-colors',
                      col.id === selectedId
                        ? 'border-copper bg-copper/5'
                        : 'border-line-admin bg-parchment-soft hover:border-ink',
                    ].join(' ')}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-ui font-semibold text-ink">{col.name}</span>
                      <span className="block text-sm text-muted">
                        {col.items.length} item{col.items.length !== 1 ? 's' : ''} ·{' '}
                        {formatEventDateTime(col.updatedAt)}
                      </span>
                    </span>
                    <ModeBadge mode={col.mode} />
                  </button>
                ))}
              </div>

              {selectedId !== null && (
                <CollectionDetail
                  collectionId={selectedId}
                  onClose={() => setSelectedId(null)}
                />
              )}
            </div>
          )
        }}
      </QueryView>
    </div>
  )
}
