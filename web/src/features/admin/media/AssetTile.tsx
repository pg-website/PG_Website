import type { MediaAssetDto } from '@/lib/api/types/admin/media'

interface AssetTileProps {
  asset: MediaAssetDto
  selected: boolean
  onClick: () => void
}

/** Single thumbnail in the asset grid. */
export function AssetTile({ asset, selected, onClick }: AssetTileProps) {
  const missingAlt = !asset.decorative && asset.alt === null
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={asset.alt ?? asset.id}
      className={[
        'group relative min-w-0 rounded-sm border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
        selected ? 'border-copper' : 'border-transparent hover:border-line-admin',
      ].join(' ')}
    >
      <div className="aspect-square overflow-hidden bg-parchment-soft">
        <img
          src={asset.src}
          alt={asset.alt ?? ''}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
      {missingAlt && (
        <span
          aria-label="Missing alt text"
          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-warning text-[0.6rem] font-bold text-white"
          title="Alt text missing"
        >
          !
        </span>
      )}
      <p className="truncate px-1 pt-1 pb-0.5 text-left font-mono text-[0.65rem] text-muted">{asset.alt ?? '—'}</p>
    </button>
  )
}
