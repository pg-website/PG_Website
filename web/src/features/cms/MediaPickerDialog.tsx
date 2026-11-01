'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/form/Field'
import { Input } from '@/components/ui/form/Input'
import { Dialog } from '@/components/ui/overlay/Dialog'
import { AssetChoices } from '@/features/cms/picker/AssetChoices'
import type { MediaAssetDto } from '@/lib/api/types/admin/media'

// CMS-F4: pick images from the media library (S09) for section slots, story media, event media and the testimonial
// portrait. Archived assets are listed (so the admin sees why) but cannot be chosen; alt text is always visible.

const SEARCH_DEBOUNCE_MS = 300

interface PickerBase {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export type MediaPickerProps =
  | (PickerBase & {
      mode: 'asset'
      /** Currently chosen id, highlighted. */
      selectedId?: string | null
      onSelect: (id: MediaAssetDto['id']) => void
    })
  | (PickerBase & {
      mode: 'assets'
      /** Ids already in the list, highlighted. Clicking toggles; the dialog stays open until "Done". */
      selectedIds: ReadonlySet<string>
      onToggle: (asset: MediaAssetDto) => void
    })

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value)
    }, ms)
    return () => {
      clearTimeout(timer)
    }
  }, [value, ms])
  return debounced
}

/**
 * Pick one image (`mode="asset"`, returns the asset id and closes) or several (`mode="assets"`, toggles each click and
 * closes on "Done"). Search is debounced; states are skeleton, error with retry, empty and data.
 */
export function MediaPickerDialog(props: MediaPickerProps) {
  const { open, onOpenChange } = props
  const multiple = props.mode === 'assets'
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim().slice(0, 100), SEARCH_DEBOUNCE_MS)
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={multiple ? 'Choose images' : 'Choose an image'}
      descriptionText={
        multiple
          ? 'Pick images from the media library. Select again to remove one. Archived images cannot be used.'
          : 'Pick an image from the media library. Archived images cannot be used.'
      }
      size="lg"
      presentation="sheet"
      footer={
        <Button
          variant={multiple ? 'primary' : 'secondary'}
          onClick={() => {
            onOpenChange(false)
          }}
        >
          {multiple ? 'Done' : 'Cancel'}
        </Button>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        <Field label="Search images" optionalLabel>
          <Input
            type="search"
            value={search}
            maxLength={100}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </Field>
        {props.mode === 'assets' ? (
          <AssetChoices
            key={q}
            q={q}
            selectedId={null}
            selectedIds={props.selectedIds}
            onPick={(_id, asset) => {
              props.onToggle(asset)
            }}
          />
        ) : (
          <AssetChoices
            key={q}
            q={q}
            selectedId={props.selectedId ?? null}
            onPick={(id) => {
              props.onSelect(id)
              onOpenChange(false)
            }}
          />
        )}
      </div>
    </Dialog>
  )
}
