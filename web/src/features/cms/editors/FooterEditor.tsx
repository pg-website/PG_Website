'use client'

import type { SectionEditorProps } from '@/features/cms/editors/editorProps'
import { ArrayField } from '@/features/cms/fields/ArrayField'
import { Group } from '@/features/cms/fields/Group'
import { ModelProvider } from '@/features/cms/fields/model'
import { LinkFields } from '@/features/cms/fields/LinkFields'
import { TextField } from '@/features/cms/fields/TextField'

export function FooterEditor({ value, onChange, disabled }: SectionEditorProps) {
  return (
    <ModelProvider value={value} onChange={onChange} disabled={disabled}>
      <div className="flex min-w-0 flex-col gap-6">
        <Group title="Footer text">
          <TextField path={['tagline']} label="Tagline" max={120} />
          <TextField path={['legalNote']} label="Legal note" max={200} multiline nullable />
        </Group>
        <Group title="Links">
          <ArrayField
            path={['links']}
            label="Footer links (up to 12)"
            noun="link"
            max={12}
            newItem={() => ({ label: '', href: '/' })}
            renderItem={(itemPath) => <LinkFields path={itemPath} labelMax={40} />}
          />
        </Group>
        <Group title="Social links">
          <ArrayField
            path={['social']}
            label="Social links (up to 8)"
            noun="social link"
            max={8}
            newItem={() => ({ label: '', href: 'https://' })}
            renderItem={(itemPath) => <LinkFields path={itemPath} labelMax={40} />}
          />
        </Group>
      </div>
    </ModelProvider>
  )
}
