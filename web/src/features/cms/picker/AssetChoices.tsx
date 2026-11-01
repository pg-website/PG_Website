'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { EmptyState } from '@/components/ui/feedback/EmptyState'
import { ErrorState } from '@/components/ui/feedback/ErrorState'
import { SkeletonRegion } from '@/components/ui/feedback/SkeletonRegion'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { TablePagination } from '@/components/ui/table/TablePagination'
import { altLabel } from '@/features/cms/picker/altLabel'
import { PickerGridSkeleton } from '@/features/cms/picker/PickerGridSkeleton'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import type { MediaAssetDto } from '@/lib/api/types/admin/media'
import { adminMediaAssetsQuery } from '@/lib/query/query-options/admin'

const PAGE_SIZE = 24

/** Image choices (S09), paged. Archived images are shown disabled with the reason. */
export function AssetChoices({
  q,
  selectedId,
  selectedIds,
  onPick,
}: {
  q: string
  selectedId: string | null
  /** Multi-select: highlights every id in the set (overrides `selectedId`). */
  selectedIds?: ReadonlySet<string>
  onPick: (id: string, asset: MediaAssetDto) => void
}) {
  const api = useApi().admin
  const [page, setPage] = useState(1)
  const query = useQuery({
    ...adminMediaAssetsQuery(api, { ...(q === '' ? {} : { q }), page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  })
  if (query.data === undefined) {
    if (query.isPending) {
      return (
        <SkeletonRegion label="Loading images">
          <PickerGridSkeleton />
        </SkeletonRegion>
      )
    }
    return (
      <ErrorState
        error={query.error}
        action="load the media library"
        headingLevel={3}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  }
  const { items, pagination } = query.data
  if (items.length === 0) {
    return (
      <EmptyState title={q === '' ? 'No images yet' : 'No image matches'} framed={false} headingLevel={3}>
        {q === '' ? 'Upload images in the Media Library first.' : 'Try a different word.'}
      </EmptyState>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((asset) => {
          const archived = asset.status === 'archived'
          const selected = selectedIds ? selectedIds.has(asset.id) : asset.id === selectedId
          const missingAlt = !asset.decorative && (asset.alt === null || asset.alt === '')
          return (
            <li key={asset.id} className="min-w-0">
              <button
                type="button"
                disabled={archived}
                aria-pressed={selected}
                onClick={() => onPick(asset.id, asset)}
                className={[
                  'flex min-h-tap w-full min-w-0 flex-col gap-1 rounded-public border-2 p-1 text-left transition-colors duration-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest disabled:cursor-not-allowed disabled:opacity-60',
                  selected ? 'border-copper' : 'border-line-admin enabled:hover:border-ink',
                ].join(' ')}
              >
                <span className="block aspect-square overflow-hidden bg-parchment-soft">
                  {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnails from the media library, same as AssetTile */}
                  <img
                    src={asset.src}
                    alt={asset.decorative ? '' : (asset.alt ?? '')}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </span>
                <span className="min-w-0 px-1 text-xs wrap-break-word text-ink">{altLabel(asset)}</span>
                {archived ? (
                  <span className="px-1 pb-1">
                    <StatusBadge tone="neutral">Archived, cannot be used</StatusBadge>
                  </span>
                ) : missingAlt ? (
                  <span className="px-1 pb-1">
                    <StatusBadge tone="warning">Alt text missing</StatusBadge>
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
      <TablePagination pagination={pagination} onPageChange={setPage} label="Image pages" />
    </div>
  )
}
