'use client'

import { useContext, useMemo } from 'react'
import { Field } from '@/components/ui/form/Field'
import { Input } from '@/components/ui/form/Input'
import { BlockEditor } from '@/features/cms/blocks/BlockEditor'
import { FieldErrorsContext } from '@/features/cms/fields/model'
import type { LegalDraft } from '@/lib/api/types/admin/cms'
import type { LegalPage } from '@/lib/api/types/legal-sitemap'

const NO_FIELD_ERRORS: ReadonlyMap<string, string> = new Map()

interface LegalEditorProps {
  page: LegalPage
  value: LegalDraft | null
  onChange: (next: LegalDraft) => void
  disabled: boolean
}

/** Legal page fields (CMS-F5): title, effective date (YYYY-MM-DD) and the closed block body. The publish confirm lives in LegalFrame. */
export function LegalEditor({ page, value, onChange, disabled }: LegalEditorProps) {
  const current = useMemo<LegalDraft>(
    () => value ?? { page, title: '', blocks: [], effectiveDate: new Date().toISOString().slice(0, 10) },
    [value, page],
  )
  // Errors come from LegalFrame (the same check that blocks Save) and only after the first Save attempt.
  const issues = useContext(FieldErrorsContext) ?? NO_FIELD_ERRORS
  return (
    <div className="flex min-w-0 flex-col gap-5">
      {value === null ? (
        <p className="text-label text-muted">
          Nothing has been written for this page yet. Start with the title and date.
        </p>
      ) : null}
      <Field label="Title" error={issues.get('title')}>
        <Input
          value={current.title}
          maxLength={120}
          disabled={disabled}
          onChange={(event) => {
            onChange({ ...current, title: event.target.value })
          }}
        />
      </Field>
      <Field label="Effective date" hint="Year-month-day, for example 2026-11-01." error={issues.get('effectiveDate')}>
        <Input
          value={current.effectiveDate}
          maxLength={10}
          inputMode="numeric"
          disabled={disabled}
          onChange={(event) => {
            onChange({ ...current, effectiveDate: event.target.value })
          }}
        />
      </Field>
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="font-display text-xl">Page body</h3>
        <BlockEditor
          value={current.blocks}
          disabled={disabled}
          error={issues.get('blocks')}
          onChange={(blocks) => {
            onChange({ ...current, blocks })
          }}
        />
      </div>
    </div>
  )
}
