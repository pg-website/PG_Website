import type { CmsContent } from '@/lib/api/types/admin/cms'

export interface SectionEditorProps {
  value: CmsContent
  onChange: (next: CmsContent) => void
  disabled: boolean
}
