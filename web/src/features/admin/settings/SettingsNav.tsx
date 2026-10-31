'use client'

import { SETTINGS_GROUPS } from '@/lib/api/types/admin/settings'
import { GROUP_LABEL, type SettingsSectionId } from '@/features/admin/settings/settings-meta'

export const SECTION_ORDER: readonly SettingsSectionId[] = [...SETTINGS_GROUPS, 'integrations']

function labelOf(id: SettingsSectionId): string {
  return id === 'integrations' ? 'Integrations' : GROUP_LABEL[id]
}

export function SettingsNav({
  active,
  onSelect,
}: {
  active: SettingsSectionId
  onSelect: (id: SettingsSectionId) => void
}) {
  return (
    <nav aria-label="Settings sections">
      <ul className="flex gap-1 overflow-x-auto md:grid md:overflow-visible">
        {SECTION_ORDER.map((id) => (
          <li key={id} className="shrink-0">
            <button
              type="button"
              aria-current={id === active ? 'page' : undefined}
              onClick={() => {
                onSelect(id)
              }}
              className="min-h-tap w-full border-l-2 border-transparent px-4 text-left font-ui text-sm font-semibold whitespace-nowrap text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 aria-[current=page]:border-copper aria-[current=page]:bg-admin-panel aria-[current=page]:text-ink"
            >
              {labelOf(id)}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
