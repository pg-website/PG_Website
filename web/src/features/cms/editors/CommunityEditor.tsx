'use client'

import type { SectionEditorProps } from '@/features/cms/editors/editorProps'
import { ArrayField } from '@/features/cms/fields/ArrayField'
import { Group } from '@/features/cms/fields/Group'
import { MediaSlotField } from '@/features/cms/fields/MediaSlotField'
import { ModelProvider } from '@/features/cms/fields/model'
import { LinkFields } from '@/features/cms/fields/LinkFields'
import { TextField } from '@/features/cms/fields/TextField'

export function CommunityEditor({ value, onChange, disabled }: SectionEditorProps) {
  return (
    <ModelProvider value={value} onChange={onChange} disabled={disabled}>
      <div className="flex min-w-0 flex-col gap-6">
        <Group title="Hero">
          <TextField path={['hero', 'eyebrow']} label="Eyebrow" max={60} />
          <TextField path={['hero', 'headline']} label="Headline" max={160} />
          <TextField path={['hero', 'lead']} label="Lead" max={400} multiline />
          <MediaSlotField path={['hero', 'media']} label="Hero images" />
        </Group>
        <Group title="Principles">
          <ArrayField
            path={['principles']}
            label="Principles (1 to 6)"
            noun="principle"
            min={1}
            max={6}
            newItem={() => ({ title: '', body: '' })}
            renderItem={(itemPath) => (
              <>
                <TextField path={[...itemPath, 'title']} label="Title" max={80} />
                <TextField path={[...itemPath, 'body']} label="Body" max={400} multiline />
              </>
            )}
          />
        </Group>
        <Group title="Hospitality">
          <TextField path={['hospitality', 'eyebrow']} label="Eyebrow" max={60} />
          <TextField path={['hospitality', 'headline']} label="Headline" max={160} />
          <TextField path={['hospitality', 'body']} label="Body" max={1200} multiline />
          <LinkFields path={['hospitality', 'cta']} />
        </Group>
      </div>
    </ModelProvider>
  )
}
