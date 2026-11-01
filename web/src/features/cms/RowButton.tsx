import type { ReactNode } from 'react'

interface RowButtonProps {
  label: string
  selected: boolean
  onSelect: () => void
  badge: ReactNode
}

/** One selectable row of the section list (44px target, current state announced). */
export function RowButton({ label, selected, onSelect, badge }: RowButtonProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={[
          'flex min-h-tap w-full min-w-0 flex-wrap items-center justify-between gap-2 rounded-public border px-3 py-3 text-left font-ui text-sm transition-colors duration-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest',
          selected
            ? 'border-forest bg-forest/10 text-ink'
            : 'border-line-admin bg-transparent text-ink hover:border-ink',
        ].join(' ')}
      >
        <span className="min-w-0 wrap-break-word">{label}</span>
        {badge}
      </button>
    </li>
  )
}
