import type { AdminPlayerRowDto } from '@/lib/api/types/admin/players'

interface PlayerResultItemProps {
  player: AdminPlayerRowDto
  selected: boolean
  onSelect: (player: AdminPlayerRowDto) => void
}

/** One player row in the search results list. */
export function PlayerResultItem({ player, selected, onSelect }: PlayerResultItemProps) {
  return (
    <button
      type="button"
      onClick={() => {
        onSelect(player)
      }}
      aria-pressed={selected}
      className={[
        'w-full rounded-public border px-3 py-2 text-left text-sm transition-colors',
        selected
          ? 'border-forest bg-forest/10 text-ink'
          : 'border-line bg-transparent text-ink hover:border-forest/40',
      ].join(' ')}
    >
      <span className="block font-semibold">{player.name}</span>
      <span className="block text-xs text-ink-soft">{player.email}</span>
    </button>
  )
}
