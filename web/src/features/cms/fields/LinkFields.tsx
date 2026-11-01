'use client'

import { TextField } from '@/features/cms/fields/TextField'
import type { Path } from '@/features/cms/fields/model'

/** Label + link pair (`cta`, nav items, footer links). */
export function LinkFields({ path, labelMax = 60 }: { path: Path; labelMax?: number }) {
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <TextField path={[...path, 'label']} label="Label" max={labelMax} />
      <TextField
        path={[...path, 'href']}
        label="Link"
        max={500}
        hint="A site path such as /events, or a full https address."
      />
    </div>
  )
}
