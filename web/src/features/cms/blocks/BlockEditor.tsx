'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useContext, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/form/Field'
import { Select } from '@/components/ui/form/Select'
import { Surface } from '@/components/ui/Surface'
import { BlockFields } from '@/features/cms/blocks/BlockFields'
import { FieldErrorsContext } from '@/features/cms/fields/model'
import { MediaPickerDialog } from '@/features/cms/MediaPickerDialog'
import type { ContentBlock } from '@/lib/api/types/content-blocks'
import type { MediaAssetDto } from '@/lib/api/types/admin/media'
import type { Page } from '@/lib/api/types/pagination'

// CMS-F5: editor for the closed block model. Offers paragraph, heading, list and image (owner decision OQ-2). Blocks of
// other types that already exist (quote, link) are kept, shown read-only and can be moved or removed. Plain text only.

type NewType = 'paragraph' | 'heading' | 'list' | 'image'

const TYPE_OPTIONS = [
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'heading', label: 'Heading' },
  { value: 'list', label: 'List' },
  { value: 'image', label: 'Image' },
] as const

const TYPE_LABEL: Record<ContentBlock['type'], string> = {
  paragraph: 'Paragraph',
  heading: 'Heading',
  list: 'List',
  image: 'Image',
  quote: 'Quote',
  link: 'Link',
}

function blankBlock(type: NewType): ContentBlock | null {
  switch (type) {
    case 'paragraph':
      return { type: 'paragraph', text: '' }
    case 'heading':
      return { type: 'heading', level: 2, text: '' }
    case 'list':
      return { type: 'list', ordered: false, items: [''] }
    case 'image':
      return null // needs a picked image first
  }
}

interface BlockEditorProps {
  value: readonly ContentBlock[]
  onChange: (next: ContentBlock[]) => void
  disabled?: boolean
  /** Message shown when the whole list fails validation. */
  error?: string
}

export function BlockEditor({ value, onChange, disabled = false, error }: BlockEditorProps) {
  const blockErrors = useContext(FieldErrorsContext)
  const [newType, setNewType] = useState<NewType>('paragraph')
  const [pickerFor, setPickerFor] = useState<{ mode: 'new' } | { mode: 'replace'; index: number } | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const replaceAt = (index: number, block: ContentBlock) => {
    onChange(value.map((b, i) => (i === index ? block : b)))
  }
  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return
    const next = [...value]
    const moved = next.splice(from, 1)[0]
    if (moved === undefined) return
    next.splice(to, 0, moved)
    onChange(next)
  }

  // The picker returns the asset id; the asset was just listed by the picker, so read it from the query cache.
  const findAsset = (id: string): MediaAssetDto | undefined => {
    const hits = queryClient.getQueriesData<Page<MediaAssetDto>>({ queryKey: ['admin', 'media', 'assets'] })
    for (const [, page] of hits) {
      const found = page?.items.find((asset) => asset.id === id)
      if (found !== undefined) return found
    }
    return undefined
  }
  const imageFrom = (asset: MediaAssetDto, caption?: string): ContentBlock => {
    const base = { src: asset.src, width: asset.width, height: asset.height, focal: asset.focal }
    const media = asset.decorative
      ? ({ ...base, decorative: true, alt: '' } as const)
      : ({ ...base, decorative: false, alt: asset.alt ?? '' } as const)
    return caption === undefined ? { type: 'image', media } : { type: 'image', media, caption }
  }
  const onPick = (id: string) => {
    const asset = findAsset(id)
    const target = pickerFor
    if (asset === undefined || target === null) {
      setPickError('That image could not be read. Open the picker and choose it again.')
      return
    }
    setPickError(null)
    if (target.mode === 'new') {
      onChange([...value, imageFrom(asset)])
    } else {
      const current = value[target.index]
      replaceAt(target.index, imageFrom(asset, current?.type === 'image' ? current.caption : undefined))
    }
  }

  const add = () => {
    if (newType === 'image') {
      setPickerFor({ mode: 'new' })
      return
    }
    const block = blankBlock(newType)
    if (block !== null) onChange([...value, block])
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {value.length === 0 ? <p className="text-label text-muted">No content yet. Add the first block below.</p> : null}
      <ol className="flex min-w-0 flex-col gap-3">
        {value.map((block, index) => (
          <li key={index} className="min-w-0">
            <Surface tone="paper" padding="md">
              <div className="flex min-w-0 flex-col gap-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="text-label font-semibold">
                    {TYPE_LABEL[block.type]}{' '}
                    <span className="font-normal text-muted">
                      ({index + 1} of {value.length})
                    </span>
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={disabled || index === 0}
                      aria-label={`Move block ${index + 1} up`}
                      onClick={() => {
                        move(index, index - 1)
                      }}
                    >
                      Up
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={disabled || index === value.length - 1}
                      aria-label={`Move block ${index + 1} down`}
                      onClick={() => {
                        move(index, index + 1)
                      }}
                    >
                      Down
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={disabled}
                      aria-label={`Remove block ${index + 1}`}
                      onClick={() => {
                        onChange(value.filter((_, i) => i !== index))
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
                <BlockFields
                  block={block}
                  index={index}
                  disabled={disabled}
                  errorAt={(suffix) => blockErrors?.get(`blocks.${index}${suffix}`)}
                  onChange={(next) => {
                    replaceAt(index, next)
                  }}
                  onReplaceImage={() => {
                    setPickerFor({ mode: 'replace', index })
                  }}
                />
              </div>
            </Surface>
          </li>
        ))}
      </ol>
      {error === undefined ? null : (
        <p role="alert" className="text-sm font-semibold text-danger-ink">
          {error}
        </p>
      )}
      {pickError === null ? null : (
        <p role="alert" className="text-sm font-semibold text-danger-ink">
          {pickError}
        </p>
      )}
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <Field label="Block type" className="min-w-40">
          <Select
            options={TYPE_OPTIONS}
            value={newType}
            disabled={disabled}
            onValueChange={(next) => {
              setNewType(next as NewType)
            }}
          />
        </Field>
        <Button variant="secondary" disabled={disabled || value.length >= 200} onClick={add}>
          Add block
        </Button>
      </div>
      <MediaPickerDialog
        mode="asset"
        open={pickerFor !== null}
        onOpenChange={(open) => {
          if (!open) setPickerFor(null)
        }}
        onSelect={onPick}
      />
    </div>
  )
}
