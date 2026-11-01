'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { ConflictInfo } from '@/components/admin/versionConflict'
import { QueryView } from '@/components/ui/feedback/QueryView'
import { useToast } from '@/components/ui/feedback/useToast'
import { SECTION_LABELS } from '@/features/cms/cmsLabels'
import { ConflictDialog } from '@/features/cms/ConflictDialog'
import { EditorChrome } from '@/features/cms/EditorChrome'
import { EditorPlaceholder } from '@/features/cms/EditorPlaceholder'
import { EditorSkeleton } from '@/features/cms/EditorSkeleton'
import type { RenderEditor } from '@/features/cms/editorTypes'
import { describeLastChange, errorBanner } from '@/features/cms/frameUtils'
import { FieldErrorsContext, issuesToFieldErrors } from '@/features/cms/fields/model'
import { PreviewButton } from '@/features/cms/PreviewButton'
import { VersionHistory } from '@/features/cms/VersionHistory'
import { usePublishSection, useSaveSectionDraft } from '@/features/cms/hooks/useCmsSectionMutations'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { saveCmsDraftSchema, type CmsContent, type SaveCmsDraftInput } from '@/lib/api/types/admin/cms'
import type { SiteSection } from '@/lib/api/types/site-content'
import { adminCmsSectionQuery } from '@/lib/query/query-options/admin'

interface SectionFrameProps {
  sectionKey: SiteSection
  onDirtyChange: (dirty: boolean) => void
  renderEditor: RenderEditor | undefined
}

/** One site section (S02 read, S03 save, S04 publish). Local edits are kept until saved, discarded or reloaded. */
export function SectionFrame({ sectionKey, onDirtyChange, renderEditor }: SectionFrameProps) {
  const api = useApi().admin
  const toast = useToast()
  const query = useQuery(adminCmsSectionQuery(api, sectionKey))
  const [working, setWorking] = useState<CmsContent | null>(null)
  const [conflict, setConflict] = useState<ConflictInfo | null>(null)
  const save = useSaveSectionDraft(sectionKey, { onConflict: setConflict })
  const publish = usePublishSection({ onConflict: setConflict })
  const dirty = working !== null

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  useEffect(
    () => () => {
      onDirtyChange(false)
    },
    [onDirtyChange],
  )

  const section = query.data
  // One validation result drives both the Save block and the inline field errors.
  const fieldErrors = useMemo(() => {
    if (working === null || section === undefined) return null
    const result = saveCmsDraftSchema.safeParse({
      key: working.key,
      version: section.version,
      content: working.content,
    })
    return result.success ? null : issuesToFieldErrors(result.error.issues)
  }, [working, section])
  // Errors stay hidden until the user tries to save, then update live as they fix fields.
  const [showErrors, setShowErrors] = useState(false)
  const visibleErrors = showErrors ? fieldErrors : null
  const validation =
    visibleErrors === null
      ? null
      : `${visibleErrors.size} ${visibleErrors.size === 1 ? 'field needs' : 'fields need'} attention. Check the fields marked below.`

  const reload = () => {
    setWorking(null)
    setConflict(null)
    setShowErrors(false)
    save.reset()
    publish.reset()
  }

  const doSave = async () => {
    if (working === null || section === undefined) return
    if (fieldErrors !== null) {
      setShowErrors(true)
      return
    }
    try {
      await save.mutateAsync({
        key: working.key,
        version: section.version,
        content: working.content,
      } as SaveCmsDraftInput)
      setWorking(null)
      setShowErrors(false)
      toast.success('Draft saved. It is not published yet.')
    } catch {
      // the error shows from save.error; local edits stay
    }
  }

  const doPublish = async () => {
    if (section === undefined) return
    try {
      await publish.mutateAsync({ key: sectionKey, version: section.version })
      toast.success('Published. The site updates shortly.')
    } catch {
      // the error shows from publish.error
    }
  }

  const label = SECTION_LABELS[sectionKey]
  return (
    <QueryView
      query={query}
      loadingLabel={`Loading ${label}`}
      skeleton={<EditorSkeleton />}
      errorAction={`load ${label}`}
      headingLevel={2}
    >
      {(data) => {
        const failure = conflict !== null ? null : (save.error ?? publish.error)
        return (
          <>
            <EditorChrome
              title={label}
              status={data.status}
              unpublished={false}
              dirty={dirty}
              saving={save.isPending}
              publishing={publish.isPending}
              hasUnpublishedChanges={data.status === 'draft' && data.draft !== null}
              conflict={conflict}
              validationMessage={validation}
              publishBlockedReason={dirty ? 'Save your changes before publishing.' : undefined}
              lastChangeText={describeLastChange(data.lastChange)}
              actionError={failure === null ? null : errorBanner(failure, save.error ? 'save the draft' : 'publish')}
              onSave={() => void doSave()}
              onDiscard={() => {
                setWorking(null)
                setShowErrors(false)
                save.reset()
              }}
              onPublish={() => void doPublish()}
              onReloadLatest={reload}
            >
              <PreviewButton sectionKey={sectionKey} hasSavedDraft={data.draft !== null} dirty={dirty} />
              {renderEditor === undefined ? (
                <EditorPlaceholder label={label} />
              ) : (
                <FieldErrorsContext value={visibleErrors}>
                  {renderEditor({
                    kind: 'section',
                    sectionKey,
                    value: working ?? data.draft ?? data.published,
                    onChange: setWorking,
                    disabled: save.isPending || publish.isPending || conflict !== null,
                  })}
                </FieldErrorsContext>
              )}
              <VersionHistory sectionKey={sectionKey} />
            </EditorChrome>
            <ConflictDialog
              conflict={conflict}
              onReload={reload}
              onKeepMine={() => {
                setConflict(null)
                save.reset()
                publish.reset()
              }}
            />
          </>
        )
      }}
    </QueryView>
  )
}
