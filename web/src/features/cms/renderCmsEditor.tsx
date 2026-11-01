'use client'

import dynamic from 'next/dynamic'
import { EditorSkeleton } from '@/features/cms/EditorSkeleton'
import type { RenderEditor } from '@/features/cms/editorTypes'

// CMS-F3 / F5: one lazy chunk per editor, loaded only when that section or page is opened.
const loading = () => <EditorSkeleton />
const HomeEditor = dynamic(() => import('@/features/cms/editors/HomeEditor').then((m) => m.HomeEditor), { loading })
const CommunityEditor = dynamic(() => import('@/features/cms/editors/CommunityEditor').then((m) => m.CommunityEditor), {
  loading,
})
const NavEditor = dynamic(() => import('@/features/cms/editors/NavEditor').then((m) => m.NavEditor), { loading })
const FooterEditor = dynamic(() => import('@/features/cms/editors/FooterEditor').then((m) => m.FooterEditor), {
  loading,
})
const MetaEditor = dynamic(() => import('@/features/cms/editors/MetaEditor').then((m) => m.MetaEditor), { loading })
const LegalEditor = dynamic(() => import('@/features/cms/legal/LegalEditor').then((m) => m.LegalEditor), { loading })

/** Plug into `SectionEditorFrame renderEditor`. */
export const renderCmsEditor: RenderEditor = (props) => {
  if (props.kind === 'legal') {
    return <LegalEditor page={props.page} value={props.value} onChange={props.onChange} disabled={props.disabled} />
  }
  if (props.value === null) {
    return (
      <p className="text-body text-muted">
        This section has no content yet, so there is nothing to edit. Ask for the initial content to be seeded first.
      </p>
    )
  }
  const shared = { value: props.value, onChange: props.onChange, disabled: props.disabled }
  switch (props.sectionKey) {
    case 'home':
      return <HomeEditor {...shared} />
    case 'community':
      return <CommunityEditor {...shared} />
    case 'nav':
      return <NavEditor {...shared} />
    case 'footer':
      return <FooterEditor {...shared} />
    case 'meta':
      return <MetaEditor {...shared} />
  }
}
