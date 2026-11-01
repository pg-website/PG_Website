'use client'

import { useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { PageIntro } from '@/components/ui/PageIntro'
import { AssetsTab } from '@/features/admin/media/AssetsTab'

/** Admin Media Library page (/admin/media, screen 34). Assets only; events, stories and pages pick from here. */
export function MediaLibraryPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex min-w-0 flex-col gap-6 py-6 sm:py-8">
      <PageIntro
        variant="admin"
        eyebrow="Media Library"
        title="Photographs are content, not decoration."
        description="Upload once, set alt text, then add to events and pages."
        actions={<Button onClick={() => fileInputRef.current?.click()}>Upload media</Button>}
      />
      <AssetsTab fileInputRef={fileInputRef} />
    </div>
  )
}
