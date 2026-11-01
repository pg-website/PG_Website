'use client'

import type { SectionEditorProps } from '@/features/cms/editors/editorProps'
import { ArrayField } from '@/features/cms/fields/ArrayField'
import { Group } from '@/features/cms/fields/Group'
import { ModelProvider } from '@/features/cms/fields/model'
import { LinkFields } from '@/features/cms/fields/LinkFields'

export function NavEditor({ value, onChange, disabled }: SectionEditorProps) {
  return (
    <ModelProvider value={value} onChange={onChange} disabled={disabled}>
      <div className="flex min-w-0 flex-col gap-6">
        <Group title="Main menu">
          <ArrayField
            path={['primary']}
            label="Menu links (1 to 8)"
            noun="link"
            min={1}
            max={8}
            newItem={() => ({ label: '', href: '/' })}
            renderItem={(itemPath) => <LinkFields path={itemPath} labelMax={40} />}
          />
        </Group>
        <Group title="Sign-in button">
          <LinkFields path={['authCta']} />
        </Group>
      </div>
    </ModelProvider>
  )
}
