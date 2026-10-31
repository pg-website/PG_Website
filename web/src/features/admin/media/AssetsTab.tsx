'use client'

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { Banner } from '@/components/ui/feedback/Banner'
import { Skeleton } from '@/components/ui/feedback/Skeleton'
import { SkeletonRegion } from '@/components/ui/feedback/SkeletonRegion'
import { ErrorState } from '@/components/ui/feedback/ErrorState'
import { TablePagination } from '@/components/ui/table/TablePagination'
import { AssetTile } from '@/features/admin/media/AssetTile'
import { AssetEditPanel } from '@/features/admin/media/AssetEditPanel'
import { useUploadFlow } from '@/features/admin/media/useUploadFlow'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import type { MediaAssetDto } from '@/lib/api/types/admin/media'
import { adminMediaAssetsQuery } from '@/lib/query/query-options/admin'

interface AssetsTabProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>
}

const PAGE_SIZE = 40
const SEARCH_DEBOUNCE_MS = 300

// Skeleton grid tiles (mirrors the real grid)
function AssetsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} shape="block" className="aspect-square w-full" />
      ))}
    </div>
  )
}

export function AssetsTab({ fileInputRef }: AssetsTabProps) {
  const api = useApi().admin
  const queryClient = useQueryClient()
  const uploadFlow = useUploadFlow()

  const [rawSearch, setRawSearch] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Debounce search input
  useEffect(() => {
    const trimmed = rawSearch.trim()
    if (trimmed === debouncedQ) return
    const timer = setTimeout(() => {
      setDebouncedQ(trimmed.slice(0, 100))
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawSearch])

  // ESC to deselect
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const query = useQuery({
    ...adminMediaAssetsQuery(api, {
      q: debouncedQ || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  })

  const selectedAsset: MediaAssetDto | null =
    selectedId !== null ? (query.data?.items.find((a) => a.id === selectedId) ?? null) : null

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void uploadFlow.upload(file)
    // Reset input so the same file can be re-selected
    e.target.value = ''
  }

  // Upload progress banner
  const uploadBanner = (() => {
    if (uploadFlow.status === 'uploading' || uploadFlow.status === 'completing') {
      const pct = uploadFlow.progress ?? 0
      return (
        <Banner tone="info">
          Uploading… {pct}%
        </Banner>
      )
    }
    if (uploadFlow.status === 'error' && uploadFlow.error) {
      return <Banner tone="danger">{uploadFlow.error}</Banner>
    }
    if (uploadFlow.status === 'done') {
      return <Banner tone="success">Upload complete.</Banner>
    }
    return null
  })()

  // Render state
  let gridContent: React.ReactNode
  if (query.data !== undefined) {
    const { items, pagination } = query.data
    gridContent = (
      <>
        {items.length === 0 ? (
          <p className="text-sm text-muted">No assets match your search.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {items.map((asset) => (
              <AssetTile
                key={asset.id}
                asset={asset}
                selected={asset.id === selectedId}
                onClick={() => setSelectedId((prev) => (prev === asset.id ? null : asset.id))}
              />
            ))}
          </div>
        )}
        <TablePagination
          pagination={pagination}
          onPageChange={setPage}
          label="Asset pages"
        />
      </>
    )
  } else if (query.isPending) {
    gridContent = (
      <SkeletonRegion label="Loading assets">
        <AssetsSkeleton />
      </SkeletonRegion>
    )
  } else {
    gridContent = (
      <ErrorState
        error={query.error}
        action="load assets"
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleFileChange}
      />

      {/* Upload progress banner */}
      {uploadBanner}

      {/* Search */}
      <div className="flex items-center gap-3">
        <label htmlFor="asset-search" className="sr-only">
          Search assets
        </label>
        <input
          id="asset-search"
          type="search"
          value={rawSearch}
          onChange={(e) => setRawSearch(e.target.value)}
          placeholder="Search by filename or alt text"
          className="min-h-control w-full max-w-sm rounded-public border border-line-admin bg-parchment-soft px-3 py-2 font-body text-body text-ink placeholder:text-muted focus:outline-2 focus:outline-offset-2 focus:outline-forest"
        />
      </div>

      {/* Two-column layout when an asset is selected */}
      {selectedAsset !== null ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div>{gridContent}</div>
          <AssetEditPanel
            asset={selectedAsset}
            onClose={() => setSelectedId(null)}
            onSaved={(updated) => {
              // Update the cached query data with the new asset
              queryClient.setQueriesData<{ items: MediaAssetDto[]; pagination: unknown }>(
                { queryKey: ['admin', 'media', 'assets'] },
                (old) =>
                  old === undefined
                    ? old
                    : { ...old, items: old.items.map((a) => (a.id === updated.id ? updated : a)) },
              )
            }}
          />
        </div>
      ) : (
        gridContent
      )}
    </div>
  )
}
