'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Eyebrow } from '@/components/ui/Eyebrow'
import { Heading } from '@/components/ui/Heading'
import { Surface } from '@/components/ui/Surface'
import { Banner } from '@/components/ui/feedback/Banner'
import { EmptyState } from '@/components/ui/feedback/EmptyState'
import { QueryView } from '@/components/ui/feedback/QueryView'
import { Skeleton } from '@/components/ui/feedback/Skeleton'
import { useToast } from '@/components/ui/feedback/useToast'
import { Field } from '@/components/ui/form/Field'
import { Select } from '@/components/ui/form/Select'
import { Switch } from '@/components/ui/form/Switch'
import { Textarea } from '@/components/ui/form/Textarea'
import type { ControlTabProps } from '@/features/event-control/tabs'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import type { EventRecapDto, UpdateRecapInput } from '@/lib/api/types/admin/control-recap'
import { qk } from '@/lib/query/keys'
import { useApiMutation } from '@/lib/query/mutation'
import { adminMediaCollectionsQuery, adminRecapQuery } from '@/lib/query/query-options/admin'

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

const NO_COLLECTION = '__none'

function GalleryRecapContent({ eventId, recap }: ContentProps) {
  const api = useApi()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [recapText, setRecapText] = useState(recap.recap ?? '')

  // Load collections for the dropdown
  const collectionsQuery = useQuery(adminMediaCollectionsQuery(api.admin))

  const recapQueryOptions = adminRecapQuery(api.admin, eventId)

  const mutation = useApiMutation<EventRecapDto, { input: UpdateRecapInput; successMessage: string }>({
    idempotent: false,
    mutationFn: ({ input }) => api.admin.control.updateRecap(eventId, input),
    invalidates: () => [qk.admin.overview(eventId)],
    onSuccess: (data, { successMessage }) => {
      queryClient.setQueryData(recapQueryOptions.queryKey, data)
      toast.success(successMessage)
    },
  })

  const update = (input: UpdateRecapInput, successMessage: string) => {
    mutation.mutate({ input, successMessage })
  }

  const handleSelectCollection = (value: string) => {
    if (value === NO_COLLECTION) {
      update({ version: recap.version, collectionId: null }, 'Gallery cleared.')
    } else {
      update({ version: recap.version, collectionId: value }, 'Gallery linked.')
    }
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

          {collectionsQuery.data?.items.length === 0 ? (
            <EmptyState title="No collections yet" headingLevel={3} framed={false}>
              <p>Create a media collection in the library first.</p>
              <div className="mt-3">
                <Button href="/admin/media" variant="secondary">Go to media library</Button>
              </div>
            </EmptyState>
          ) : (
            <Field
              label="Gallery collection"
              hint={recap.collectionId !== null ? 'Shown on the public archive page.' : undefined}
            >
              <Select
                value={recap.collectionId !== null ? String(recap.collectionId) : NO_COLLECTION}
                onValueChange={handleSelectCollection}
                disabled={mutation.isPending || collectionsQuery.isPending}
                options={[
                  { value: NO_COLLECTION, label: 'No gallery' },
                  ...(collectionsQuery.data?.items ?? []).map((c) => ({
                    value: String(c.id),
                    label: `${c.name} (${c.items.length} image${c.items.length !== 1 ? 's' : ''})`,
                  })),
                ]}
              />
            </Field>
          )}
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

          {!recap.canPublishArchive.allowed && (
            <Banner tone="warning">{recap.canPublishArchive.reason}</Banner>
          )}

          <Field label="Recap text">
            <Textarea
              rows={8}
              maxLength={4000}
              value={recapText}
              onChange={(e) => setRecapText(e.target.value)}
              placeholder="Describe what happened at this event…"
            />
          </Field>

          <Button variant="primary" onClick={handleSaveRecap} loading={mutation.isPending}>
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
