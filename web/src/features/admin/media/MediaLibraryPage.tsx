'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { PageIntro } from '@/components/ui/PageIntro'
import { AssetsTab } from '@/features/admin/media/AssetsTab'
import { CollectionsTab } from '@/features/admin/media/CollectionsTab'

type Tab = 'assets' | 'collections'

const TABS: { value: Tab; label: string }[] = [
  { value: 'assets', label: 'Assets' },
  { value: 'collections', label: 'Collections' },
]

/** Admin Media Library page (/admin/media, screen 34). */
export function MediaLibraryPage() {
  const [tab, setTab] = useState<Tab>('assets')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const triggerUpload = () => {
    setTab('assets')
    fileInputRef.current?.click()
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 py-6 sm:py-8">
      <PageIntro
        variant="admin"
        eyebrow="Media Library"
        title="Photographs are content, not decoration."
        description="Upload once, set alt metadata, then attach to reusable collections."
        actions={<Button onClick={triggerUpload}>Upload media</Button>}
      />

      {/* Tab switcher */}
      <div role="group" aria-label="Media sections" className="flex flex-wrap gap-2">
        {TABS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
            className={[
              'min-h-tap rounded-public border px-3 py-2 font-ui text-sm transition-colors duration-control',
              tab === value
                ? 'border-forest bg-forest text-parchment'
                : 'border-line-admin bg-transparent text-ink hover:border-ink',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'assets' ? (
        <AssetsTab fileInputRef={fileInputRef} />
      ) : (
        <CollectionsTab />
      )}
    </div>
  )
}
