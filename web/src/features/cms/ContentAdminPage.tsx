'use client'

import { useCallback, useState } from 'react'
import { SplitWorkspace } from '@/components/admin/SplitWorkspace'
import { PageIntro } from '@/components/ui/PageIntro'
import { Text } from '@/components/ui/Text'
import { SectionEditorFrame } from '@/features/cms/SectionEditorFrame'
import type { CmsSelection } from '@/features/cms/cmsLabels'
import { renderCmsEditor } from '@/features/cms/renderCmsEditor'
import { SectionList } from '@/features/cms/SectionList'
import { useDirtyGuard } from '@/features/cms/useDirtyGuard'

/** Admin Website CMS page (/admin/content, screen 33): section list on the left, editor frame on the right. */
export function ContentAdminPage() {
  const [selection, setSelection] = useState<CmsSelection | null>(null)
  const [dirty, setDirty] = useState(false)
  const { guard, requestLeave } = useDirtyGuard(dirty)
  const onDirtyChange = useCallback((next: boolean) => {
    setDirty(next)
  }, [])

  return (
    <div className="flex min-w-0 flex-col gap-6 py-6 sm:py-8">
      <PageIntro
        variant="admin"
        eyebrow="Website CMS"
        title="Edit the words on the site."
        description="Text only. Save a draft, check it, then publish when it is ready."
      />
      <SplitWorkspace
        listLabel="Content sections"
        detailLabel="Section editor"
        detailOpen={selection !== null}
        onBack={() => requestLeave(() => setSelection(null))}
        list={
          <SectionList
            selected={selection}
            onSelect={(next) => {
              if (selection !== null && selection.kind === next.kind && selection.key === next.key) return
              requestLeave(() => setSelection(next))
            }}
          />
        }
        detail={
          selection === null ? (
            <Text className="hidden text-muted lg:block">Pick a section on the left to edit it.</Text>
          ) : (
            <SectionEditorFrame selection={selection} onDirtyChange={onDirtyChange} renderEditor={renderCmsEditor} />
          )
        }
      />
      {guard}
    </div>
  )
}
