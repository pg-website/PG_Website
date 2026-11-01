'use client'

import type { SectionEditorProps } from '@/features/cms/editors/editorProps'
import { ArrayField } from '@/features/cms/fields/ArrayField'
import { Group } from '@/features/cms/fields/Group'
import { MediaSlotField } from '@/features/cms/fields/MediaSlotField'
import { ModelProvider } from '@/features/cms/fields/model'
import { LinkFields } from '@/features/cms/fields/LinkFields'
import { TextField } from '@/features/cms/fields/TextField'

const titleBody = () => ({ title: '', body: '' })

export function HomeEditor({ value, onChange, disabled }: SectionEditorProps) {
  return (
    <ModelProvider value={value} onChange={onChange} disabled={disabled}>
      <div className="flex min-w-0 flex-col gap-6">
        <Group title="Hero">
          <TextField path={['hero', 'eyebrow']} label="Eyebrow" max={60} />
          <TextField path={['hero', 'headlineLine1']} label="Headline, first line" max={80} />
          <TextField path={['hero', 'headlineAccent']} label="Headline, accent line" max={80} />
          <TextField path={['hero', 'lead']} label="Lead" max={200} multiline />
          <TextField path={['hero', 'body']} label="Body" max={1200} multiline />
          <ArrayField
            path={['hero', 'proofPoints']}
            label="Proof points"
            noun="proof point"
            max={6}
            newItem={() => ''}
            renderItem={(itemPath) => <TextField path={itemPath} label="Text" max={60} />}
          />
          <h4 className="text-label font-semibold">Primary button</h4>
          <LinkFields path={['hero', 'primaryCta']} />
          <h4 className="text-label font-semibold">Secondary button</h4>
          <LinkFields path={['hero', 'secondaryCta']} />
          <MediaSlotField path={['hero', 'media']} label="Hero images" />
        </Group>
        <Group title="Upcoming games">
          <TextField path={['upcoming', 'eyebrow']} label="Eyebrow" max={60} />
          <TextField path={['upcoming', 'title']} label="Title" max={100} />
          <TextField path={['upcoming', 'intro']} label="Intro" max={300} multiline />
          <LinkFields path={['upcoming', 'cta']} />
        </Group>
        <Group title="First visit">
          <TextField path={['firstVisit', 'eyebrow']} label="Eyebrow" max={60} />
          <TextField path={['firstVisit', 'headline']} label="Headline" max={160} />
          <TextField path={['firstVisit', 'body']} label="Body" max={1200} multiline />
          <LinkFields path={['firstVisit', 'cta']} />
          <ArrayField
            path={['firstVisit', 'promises']}
            label="Promises (exactly 4)"
            noun="promise"
            fixed
            newItem={titleBody}
            renderItem={(itemPath) => (
              <>
                <TextField path={[...itemPath, 'title']} label="Title" max={80} />
                <TextField path={[...itemPath, 'body']} label="Body" max={400} multiline />
              </>
            )}
          />
          <MediaSlotField path={['firstVisit', 'media']} label="First visit images" />
        </Group>
        <Group title="What we stand for">
          <TextField path={['stands', 'eyebrow']} label="Eyebrow" max={60} />
          <TextField path={['stands', 'headline']} label="Headline" max={160} />
          <TextField path={['stands', 'body']} label="Body" max={1200} multiline />
          <ArrayField
            path={['stands', 'principles']}
            label="Principles (exactly 3)"
            noun="principle"
            fixed
            newItem={titleBody}
            renderItem={(itemPath) => (
              <>
                <TextField path={[...itemPath, 'title']} label="Title" max={80} />
                <TextField path={[...itemPath, 'body']} label="Body" max={400} multiline />
              </>
            )}
          />
          <MediaSlotField path={['stands', 'media']} label="Images" />
        </Group>
        <Group title="More than a game">
          <TextField path={['moreThanAGame', 'eyebrow']} label="Eyebrow" max={60} />
          <TextField path={['moreThanAGame', 'headline']} label="Headline" max={160} />
          <TextField path={['moreThanAGame', 'body']} label="Body" max={1200} multiline />
          <LinkFields path={['moreThanAGame', 'cta']} />
          <MediaSlotField path={['moreThanAGame', 'media']} label="Images" />
        </Group>
        <Group title="Final call to action">
          <TextField path={['finalCta', 'eyebrow']} label="Eyebrow" max={60} />
          <TextField path={['finalCta', 'headline']} label="Headline" max={160} />
          <TextField path={['finalCta', 'body']} label="Body" max={1200} multiline />
          <LinkFields path={['finalCta', 'cta']} />
          <MediaSlotField path={['finalCta', 'media']} label="Images" />
        </Group>
      </div>
    </ModelProvider>
  )
}
