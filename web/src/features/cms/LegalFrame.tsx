'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { ConflictInfo } from '@/components/admin/versionConflict'
import { QueryView } from '@/components/ui/feedback/QueryView'
import { useToast } from '@/components/ui/feedback/useToast'
import { ConfirmDialog } from '@/components/ui/overlay/ConfirmDialog'
import { LEGAL_LABELS } from '@/features/cms/cmsLabels'
import { ConflictDialog } from '@/features/cms/ConflictDialog'
import { EditorChrome } from '@/features/cms/EditorChrome'
import { EditorPlaceholder } from '@/features/cms/EditorPlaceholder'
import { EditorSkeleton } from '@/features/cms/EditorSkeleton'
import type { RenderEditor } from '@/features/cms/editorTypes'
import { FieldErrorsContext, legalIssuesToFieldErrors } from '@/features/cms/fields/model'
import { describeLastChange, errorBanner } from '@/features/cms/frameUtils'
import { usePublishLegalPage, useSaveLegalDraft } from '@/features/cms/hooks/useCmsSectionMutations'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { saveLegalDraftSchema, type LegalDraft } from '@/lib/api/types/admin/cms'
import type { LegalPage } from '@/lib/api/types/legal-sitemap'
import { adminLegalPageQuery } from '@/lib/query/query-options/admin'

interface LegalFrameProps {
  page: LegalPage
  onDirtyChange: (dirty: boolean) => void
  renderEditor: RenderEditor | undefined
}

/**
 * One legal page (S06). Publishing first asks "This is a legal page, are you sure?" (owner decision OQ-4); the
 * Idempotency-Key lives in the publish hook, so the dialog only gates the call.
 */
export function LegalFrame({ page, onDirtyChange, renderEditor }: LegalFrameProps) {
  const api = useApi().admin
  const toast = useToast()
  const query = useQuery(adminLegalPageQuery(api, page))
  const [working, setWorking] = useState<LegalDraft | null>(null)
  const [conflict, setConflict] = useState<ConflictInfo | null>(null)
  const [confirming, setConfirming] = useState(false)
  const save = useSaveLegalDraft({ onConflict: setConflict })
  const publish = usePublishLegalPage({ onConflict: setConflict })
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

  const data = query.data
  // One validation result drives both the Save block and the inline field errors.
  const fieldErrors = useMemo(() => {
    if (working === null || data === undefined) return null
    const result = saveLegalDraftSchema.safeParse({
      version: data.version,
      title: working.title,
      blocks: working.blocks,
      effectiveDate: working.effectiveDate,
    })
    return result.success ? null : legalIssuesToFieldErrors(result.error.issues)
  }, [working, data])
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
    if (working === null || data === undefined) return
    if (fieldErrors !== null) {
      setShowErrors(true)
      return
    }
    try {
      await save.mutateAsync({
        page,
        input: {
          version: data.version,
          title: working.title,
          blocks: working.blocks,
          effectiveDate: working.effectiveDate,
        },
      })
      setWorking(null)
      setShowErrors(false)
      toast.success('Draft saved. It is not published yet.')
    } catch {
      // the error shows from save.error; local edits stay
    }
  }

  const doPublish = async () => {
    if (data === undefined) return
    try {
      await publish.mutateAsync({ page, version: data.version })
      toast.success('Published. The site updates shortly.')
    } catch {
      // the error shows from publish.error
    } finally {
      setConfirming(false)
    }
  }

  const label = LEGAL_LABELS[page]
  return (
    <QueryView
      query={query}
      loadingLabel={`Loading ${label}`}
      skeleton={<EditorSkeleton />}
      errorAction={`load ${label}`}
      headingLevel={2}
    >
      {(legal) => {
        const failure = conflict !== null ? null : (save.error ?? publish.error)
        return (
          <>
            <EditorChrome
              title={label}
              status={legal.status}
              unpublished={legal.published === null}
              dirty={dirty}
              saving={save.isPending}
              publishing={publish.isPending}
              hasUnpublishedChanges={legal.status === 'draft' && legal.draft !== null}
              conflict={conflict}
              validationMessage={validation}
              publishBlockedReason={dirty ? 'Save your changes before publishing.' : undefined}
              lastChangeText={describeLastChange(legal.lastChange)}
              actionError={failure === null ? null : errorBanner(failure, save.error ? 'save the draft' : 'publish')}
              onSave={() => void doSave()}
              onDiscard={() => {
                setWorking(null)
                setShowErrors(false)
                save.reset()
              }}
              onPublish={() => {
                setConfirming(true)
              }}
              onReloadLatest={reload}
            >
              {renderEditor === undefined ? (
                <EditorPlaceholder label={label} />
              ) : (
                <FieldErrorsContext value={visibleErrors}>
                  {renderEditor({
                    kind: 'legal',
                    page,
                    value: working ?? legal.draft ?? legal.published,
                    onChange: setWorking,
                    disabled: save.isPending || publish.isPending || conflict !== null,
                  })}
                </FieldErrorsContext>
              )}
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
            <ConfirmDialog
              open={confirming}
              onOpenChange={setConfirming}
              onConfirm={() => void doPublish()}
              title="Publish legal page?"
              consequence="This is a legal page, are you sure?"
              confirmLabel="Publish"
              loading={publish.isPending}
              loadingLabel="Publishing"
            />
          </>
        )
      }}
    </QueryView>
  )
}
