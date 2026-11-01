'use client'

import { useModel, type Path } from '@/features/cms/fields/model'
import { AssetListField } from '@/features/media/AssetListField'
import type { MediaAssetSummary } from '@/lib/api/types/admin/media'
import { MEDIA_INTERVAL_DEFAULT } from '@/lib/api/types/admin/media'
import type { MediaCollection } from '@/lib/api/types/media'

// Image slot of a section (PLAN-010). The draft saves `media: { assetIds, autoplay, intervalMs }`; the read also returns
// `items` (public shape), `assets` and the derived `mode`. Editing keeps `items` in step so the preview matches.

type Slot = MediaCollection & { assetIds?: string[]; assets?: MediaAssetSummary[] }

function toItem(asset: MediaAssetSummary): MediaCollection['items'][number] | null {
  const base = { src: asset.src, width: asset.width, height: asset.height, focal: asset.focal }
  if (asset.decorative) return { ...base, decorative: true, alt: '' }
  // An image without alt cannot be shown publicly; it stays in `assetIds` and the field warns about it.
  return asset.alt === null || asset.alt === '' ? null : { ...base, decorative: false, alt: asset.alt }
}

export function MediaSlotField({ path, label }: { path: Path; label: string }) {
  const model = useModel()
  const raw = model.get(path) as Slot | undefined
  const assets = raw?.assets ?? []
  const assetIds = raw?.assetIds ?? assets.map((a) => a.id)
  const error =
    model.errorAt(path) ??
    model.errorAt([...path, 'assetIds']) ??
    [...Array(assetIds.length).keys()].map((i) => model.errorAt([...path, 'assetIds', i])).find(Boolean)

  const write = (next: Partial<Slot>) => {
    const current: Slot = raw ?? { mode: 'static', autoplay: false, intervalMs: MEDIA_INTERVAL_DEFAULT, items: [] }
    model.set(path, { ...current, ...next })
  }

  return (
    <AssetListField
      label={label}
      value={assetIds}
      assets={assets}
      disabled={model.disabled}
      {...(error === undefined ? {} : { error })}
      onChange={(ids, summaries) => {
        write({
          assetIds: ids,
          assets: summaries,
          mode: ids.length > 1 ? 'carousel' : 'static',
          items: summaries.flatMap((s) => {
            const item = toItem(s)
            return item === null ? [] : [item]
          }),
        })
      }}
      autoplay={{
        autoplay: raw?.autoplay ?? false,
        intervalMs: raw?.intervalMs ?? MEDIA_INTERVAL_DEFAULT,
        onChange: (next) => {
          write(next)
        },
      }}
    />
  )
}
