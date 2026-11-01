'use client'

import type { ReactNode } from 'react'
import { SaveBar } from '@/components/admin/SaveBar'
import type { ConflictInfo } from '@/components/admin/versionConflict'
import { Banner } from '@/components/ui/feedback/Banner'
import { CmsStatusBadge } from '@/features/cms/CmsStatusBadge'
import type { CmsRowStatus } from '@/lib/api/types/admin/cms'

interface EditorChromeProps {
  title: string
  status: CmsRowStatus
  unpublished: boolean
  dirty: boolean
  saving: boolean
  publishing: boolean
  hasUnpublishedChanges: boolean
  conflict: ConflictInfo | null
  validationMessage: string | null
  publishBlockedReason: string | undefined
  lastChangeText: string | null
  actionError: ReactNode
  onSave: () => void
  onDiscard: () => void
  onPublish: () => void
  onReloadLatest: () => void
  children: ReactNode
}

/** Shared frame: heading, status, banners, the editor slot and the SaveBar. */
export function EditorChrome(props: EditorChromeProps) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="min-w-0 flex-1 font-display text-2xl wrap-break-word">{props.title}</h2>
        <CmsStatusBadge status={props.status} unpublished={props.unpublished} />
      </div>
      {props.lastChangeText === null ? null : <p className="text-label text-muted">{props.lastChangeText}</p>}
      {props.validationMessage === null ? null : (
        <Banner tone="warning" title="Fix these before saving">
          {props.validationMessage}
        </Banner>
      )}
      {props.actionError}
      <div className="min-w-0">{props.children}</div>
      <SaveBar
        dirty={props.dirty}
        saving={props.saving}
        publishing={props.publishing}
        onSave={props.onSave}
        onDiscard={props.onDiscard}
        onPublish={props.onPublish}
        publishBlockedReason={props.publishBlockedReason}
        conflict={props.conflict}
        onReloadLatest={props.onReloadLatest}
        hasUnpublishedChanges={props.hasUnpublishedChanges}
      />
    </div>
  )
}
