import type { ReactNode } from 'react'
import type { CmsSelection } from '@/features/cms/cmsLabels'
import type { CmsContent, LegalDraft } from '@/lib/api/types/admin/cms'
import type { LegalPage } from '@/lib/api/types/legal-sitemap'
import type { SiteSection } from '@/lib/api/types/site-content'

/**
 * What the per-section editors (CMS-F3 sections, CMS-F5 legal) receive. `value` is the working copy (the unsaved edit, else
 * the saved draft, else the published copy, else null when nothing exists yet); `onChange` marks the frame dirty.
 */
export type EditorSlotProps =
  | {
      kind: 'section'
      sectionKey: SiteSection
      value: CmsContent | null
      onChange: (next: CmsContent) => void
      disabled: boolean
    }
  | {
      kind: 'legal'
      page: LegalPage
      value: LegalDraft | null
      onChange: (next: LegalDraft) => void
      disabled: boolean
    }

export type RenderEditor = (props: EditorSlotProps) => ReactNode

export interface SectionEditorFrameProps {
  selection: CmsSelection
  /** Reports whether unsaved edits exist (feeds the leave guard). */
  onDirtyChange: (dirty: boolean) => void
  /** Plug-in point for the typed field editors (F3 / F5). Without it the frame shows a placeholder. */
  renderEditor?: RenderEditor
}
