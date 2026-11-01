'use client'

import type { SectionEditorFrameProps } from '@/features/cms/editorTypes'
import { LegalFrame } from '@/features/cms/LegalFrame'
import { SectionFrame } from '@/features/cms/SectionFrame'

/**
 * Right pane of the content admin (CMS-F2): loads one section or legal page, holds the working copy and wires SaveBar
 * (clean, dirty, validation blocked, saved-not-published, published, conflict). Keyed by selection, so switching resets
 * local state. The typed field editors plug in through `renderEditor` (CMS-F3 / CMS-F5).
 */
export function SectionEditorFrame({ selection, onDirtyChange, renderEditor }: SectionEditorFrameProps) {
  return selection.kind === 'section' ? (
    <SectionFrame
      key={`section:${selection.key}`}
      sectionKey={selection.key}
      onDirtyChange={onDirtyChange}
      renderEditor={renderEditor}
    />
  ) : (
    <LegalFrame
      key={`legal:${selection.key}`}
      page={selection.key}
      onDirtyChange={onDirtyChange}
      renderEditor={renderEditor}
    />
  )
}
