'use client'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/form/Field'
import { Input } from '@/components/ui/form/Input'
import { Select } from '@/components/ui/form/Select'
import { Switch } from '@/components/ui/form/Switch'
import { Textarea } from '@/components/ui/form/Textarea'
import type { ContentBlock } from '@/lib/api/types/content-blocks'

export function BlockFields({
  block,
  index,
  disabled,
  onChange,
  onReplaceImage,
  errorAt,
}: {
  block: ContentBlock
  index: number
  disabled: boolean
  onChange: (next: ContentBlock) => void
  onReplaceImage: () => void
  /** Error for a field of this block; `suffix` is the path below the block, e.g. `.text` or `.items.2`. */
  errorAt: (suffix: string) => string | undefined
}) {
  const n = index + 1
  switch (block.type) {
    case 'paragraph':
      return (
        <Field label={`Paragraph text (block ${n})`} error={errorAt('.text')}>
          <Textarea
            rows={5}
            value={block.text}
            maxLength={4000}
            disabled={disabled}
            onChange={(event) => {
              onChange({ ...block, text: event.target.value })
            }}
          />
        </Field>
      )
    case 'heading':
      return (
        <div className="grid min-w-0 gap-3 sm:grid-cols-[1fr_10rem]">
          <Field label={`Heading text (block ${n})`} error={errorAt('.text')}>
            <Input
              value={block.text}
              maxLength={200}
              disabled={disabled}
              onChange={(event) => {
                onChange({ ...block, text: event.target.value })
              }}
            />
          </Field>
          <Field label="Level">
            <Select
              options={[
                { value: '2', label: 'Section (H2)' },
                { value: '3', label: 'Sub-section (H3)' },
              ]}
              value={String(block.level)}
              disabled={disabled}
              onValueChange={(next) => {
                onChange({ ...block, level: next === '3' ? 3 : 2 })
              }}
            />
          </Field>
        </div>
      )
    case 'list':
      return (
        <div className="flex min-w-0 flex-col gap-3">
          <Switch
            label="Numbered list"
            checked={block.ordered}
            disabled={disabled}
            onCheckedChange={(ordered) => {
              onChange({ ...block, ordered })
            }}
          />
          {block.items.map((item, i) => (
            <div key={i} className="flex min-w-0 items-end gap-2">
              <Field label={`Item ${i + 1} (block ${n})`} className="min-w-0 flex-1" error={errorAt(`.items.${i}`)}>
                <Input
                  value={item}
                  maxLength={500}
                  disabled={disabled}
                  onChange={(event) => {
                    onChange({ ...block, items: block.items.map((it, j) => (j === i ? event.target.value : it)) })
                  }}
                />
              </Field>
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled || block.items.length <= 1}
                aria-label={`Remove item ${i + 1} of block ${n}`}
                onClick={() => {
                  onChange({ ...block, items: block.items.filter((_, j) => j !== i) })
                }}
              >
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled || block.items.length >= 50}
              onClick={() => {
                onChange({ ...block, items: [...block.items, ''] })
              }}
            >
              Add item
            </Button>
          </div>
        </div>
      )
    case 'image':
      return (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-public bg-parchment-soft">
              {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of a library image */}
              <img src={block.media.src} alt={block.media.alt} className="h-full w-full object-cover" />
            </div>
            <p className="min-w-0 text-label wrap-break-word text-muted">
              {block.media.decorative ? 'Decorative image (no alt text).' : `Alt text: ${block.media.alt}`}
            </p>
          </div>
          <Field label={`Caption (block ${n})`} optionalLabel error={errorAt('.caption')}>
            <Input
              value={block.caption ?? ''}
              maxLength={300}
              disabled={disabled}
              onChange={(event) => {
                const caption = event.target.value
                onChange(
                  caption === ''
                    ? { type: 'image', media: block.media }
                    : { type: 'image', media: block.media, caption },
                )
              }}
            />
          </Field>
          <div>
            <Button size="sm" variant="secondary" disabled={disabled} onClick={onReplaceImage}>
              Change image
            </Button>
          </div>
        </div>
      )
    case 'quote':
      return (
        <p className="min-w-0 text-body wrap-break-word">
          “{block.text}”{block.attribution === undefined ? '' : ` — ${block.attribution}`}
          <span className="block text-label text-muted">
            Quote blocks cannot be edited here yet. You can move or remove it.
          </span>
        </p>
      )
    case 'link':
      return (
        <p className="min-w-0 text-body wrap-break-word">
          {block.label} ({block.href})
          <span className="block text-label text-muted">
            Link blocks cannot be edited here yet. You can move or remove it.
          </span>
        </p>
      )
  }
}
