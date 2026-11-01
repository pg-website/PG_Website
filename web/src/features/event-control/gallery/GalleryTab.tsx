'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Eyebrow } from '@/components/ui/Eyebrow'
import { Heading } from '@/components/ui/Heading'
import { Surface } from '@/components/ui/Surface'
import { Banner } from '@/components/ui/feedback/Banner'
import { QueryView } from '@/components/ui/feedback/QueryView'
import { Skeleton } from '@/components/ui/feedback/Skeleton'
import { useToast } from '@/components/ui/feedback/useToast'
import { Field } from '@/components/ui/form/Field'
import { Switch } from '@/components/ui/form/Switch'
import { Textarea } from '@/components/ui/form/Textarea'
import type { ControlTabProps } from '@/features/event-control/tabs'
import { AssetListField } from '@/features/media/AssetListField'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { copyFor, fieldErrorsFrom } from '@/lib/api/error-copy'
import type { EventRecapDto, UpdateRecapInput } from '@/lib/api/types/admin/control-recap'
import { qk } from '@/lib/query/keys'
import { useApiMutation } from '@/lib/query/mutation'
import { adminMediaAssetsQuery, adminRecapQuery } from '@/lib/query/query-options/admin'

/** Gallery and recap tab (screen 52, C16). */
export function GalleryTab({ eventId }: ControlTabProps) {
  const api = useApi()
  const query = useQuery(adminRecapQuery(api.admin, eventId))

  return (
    <QueryView
      query={query}
      loadingLabel="Loading gallery and recap"
      skeleton={
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
      errorAction="load gallery and recap"
    >
      {(recap) => <GalleryRecapContent eventId={eventId} recap={recap} />}
    </QueryView>
  )
}

interface ContentProps {
  eventId: string
  recap: EventRecapDto
}

function GalleryRecapContent({ eventId, recap }: ContentProps) {
  const api = useApi()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [recapText, setRecapText] = useState(recap.recap ?? '')

  const [assetIds, setAssetIds] = useState<string[]>(recap.assetIds)
  // The recap read carries ids only; thumbnails come from the library (newest page, server maximum).
  const assetsQuery = useQuery(adminMediaAssetsQuery(api.admin, { pageSize: 100 }))
  const dirty = assetIds.length !== recap.assetIds.length || assetIds.some((id, i) => id !== recap.assetIds[i])

  const recapQueryOptions = adminRecapQuery(api.admin, eventId)

  const mutation = useApiMutation<EventRecapDto, { input: UpdateRecapInput; successMessage: string }>({
    idempotent: false,
    mutationFn: ({ input }) => api.admin.control.updateRecap(eventId, input),
    invalidates: () => [qk.admin.overview(eventId)],
    onSuccess: (data, { successMessage }) => {
      queryClient.setQueryData(recapQueryOptions.queryKey, data)
      toast.success(successMessage)
    },
    onError: (error) => {
      const formMessage = fieldErrorsFrom(error).form?.[0]
      toast.error(formMessage ?? copyFor(error, { action: 'save the gallery and recap' }).body)
    },
  })
  // The server accepts recap and gallery edits only for a completed event (C16).
  const editable = recap.canPublishArchive.allowed

  const update = (input: UpdateRecapInput, successMessage: string) => {
    mutation.mutate({ input, successMessage })
  }

  const handleSaveGallery = () => {
    update({ version: recap.version, assetIds }, assetIds.length === 0 ? 'Gallery cleared.' : 'Gallery saved.')
  }

  const handleSaveRecap = () => {
    update({ version: recap.version, recap: recapText }, 'Recap saved.')
  }

  const handleTogglePublish = (checked: boolean) => {
    update(
      { version: recap.version, publishArchive: checked },
      checked ? 'Archive published.' : 'Archive unpublished.',
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Gallery card */}
      <Surface as="section" tone="admin" padding="lg" aria-labelledby="gallery-heading">
        <div className="flex flex-col gap-6">
          <div className="grid gap-1">
            <Eyebrow>Gallery</Eyebrow>
            <Heading level={2} size="card" id="gallery-heading">
              Preserve the room after it ends.
            </Heading>
          </div>

          <AssetListField
            label="Gallery images"
            hint="Shown on the public archive page, in this order. Upload or choose from the library."
            value={assetIds}
            assets={assetsQuery.data?.items ?? []}
            onChange={setAssetIds}
            disabled={mutation.isPending || !editable}
          />
          <Button
            variant="primary"
            onClick={handleSaveGallery}
            loading={mutation.isPending}
            disabled={!dirty || !editable}
          >
            Save gallery
          </Button>
        </div>
      </Surface>

      {/* Recap card */}
      <Surface as="section" tone="admin" padding="lg" aria-labelledby="recap-heading">
        <div className="flex flex-col gap-6">
          <div className="grid gap-1">
            <Eyebrow>Recap</Eyebrow>
            <Heading level={2} size="card" id="recap-heading">
              What happened?
            </Heading>
          </div>

          {!editable && (
            <Banner tone="warning">
              The gallery and recap can be edited only after the event is completed.
            </Banner>
          )}

          <Field label="Recap text">
            <Textarea
              rows={8}
              maxLength={4000}
              value={recapText}
              onChange={(e) => setRecapText(e.target.value)}
              disabled={!editable}
              placeholder="Describe what happened at this event…"
            />
          </Field>

          <Button variant="primary" onClick={handleSaveRecap} loading={mutation.isPending} disabled={!editable}>
            Save recap
          </Button>

          <Switch
            label="Publish archive page"
            description={recap.archivePublished ? 'Live on the public event page' : 'Not published yet'}
            checked={recap.archivePublished}
            onCheckedChange={handleTogglePublish}
            disabled={!recap.canPublishArchive.allowed || mutation.isPending}
          />

          {recap.lastChange !== null && (
            <p className="text-sm text-muted">Last saved by {recap.lastChange.by.name}</p>
          )}
        </div>
      </Surface>
    </div>
  )
}
