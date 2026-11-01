'use client'

import { useWatch } from 'react-hook-form'
import { FormField } from '@/components/ui/form/FormField'
import { Heading } from '@/components/ui/Heading'
import { useStepForm } from '@/features/event-builder/context'
import type { BuilderStepProps } from '@/features/event-builder/types'
import { AssetListField } from '@/features/media/AssetListField'
import type { MediaStep as MediaValues } from '@/lib/api/types/admin/event-builder'

// Builder step 6: the event's images (PLAN-010). An ordered list of assets; the first is the cover. One image is
// static, two or more is a carousel (derived by the server, never chosen here).

export function MediaStep({ dataKey }: BuilderStepProps) {
  const form = useStepForm<MediaValues>(dataKey ?? 'media')
  const { control, setValue } = form
  const assets = useWatch({ control, name: 'assets' })
  const autoplay = useWatch({ control, name: 'autoplay' })
  const intervalMs = useWatch({ control, name: 'intervalMs' })

  return (
    <div className="grid min-w-0 gap-6">
      <section aria-labelledby="media-images" className="grid min-w-0 gap-4">
        <Heading level={2} size="card" id="media-images">
          Images
        </Heading>
        <p className="font-ui text-sm text-muted">
          Optional. The first image is the cover. Every image needs alt text (or marked decorative) before the event can
          be published.
        </p>
        <FormField control={control} name="assetIds" label="Event images" group optionalLabel>
          {(field) => (
            <AssetListField
              label="Event images"
              hint="One image shows static; two or more show as a carousel."
              value={field.value}
              assets={assets}
              onChange={(ids) => {
                field.onChange(ids)
              }}
              autoplay={{
                autoplay,
                intervalMs,
                onChange: (next) => {
                  setValue('autoplay', next.autoplay, { shouldDirty: true })
                  setValue('intervalMs', next.intervalMs, { shouldDirty: true })
                },
              }}
            />
          )}
        </FormField>
      </section>
    </div>
  )
}
