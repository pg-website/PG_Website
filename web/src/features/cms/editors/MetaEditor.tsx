'use client'

import type { SectionEditorProps } from '@/features/cms/editors/editorProps'
import { Group } from '@/features/cms/fields/Group'
import { ModelProvider } from '@/features/cms/fields/model'
import { TextField } from '@/features/cms/fields/TextField'

export function MetaEditor({ value, onChange, disabled }: SectionEditorProps) {
  return (
    <ModelProvider value={value} onChange={onChange} disabled={disabled}>
      <Group title="Search and sharing defaults">
        <TextField path={['siteName']} label="Site name" max={60} />
        <TextField
          path={['titleTemplate']}
          label="Page title template"
          max={80}
          hint="How page titles are written, for example %s | Site name."
        />
        <TextField path={['description']} label="Description" max={300} multiline />
        <TextField path={['defaultCity']} label="Default city" max={80} />
      </Group>
    </ModelProvider>
  )
}
