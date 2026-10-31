'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form'
import type { ZodType } from 'zod'
import { SaveBar } from '@/components/admin/SaveBar'
import { isVersionConflict } from '@/components/admin/versionConflict'
import { Banner } from '@/components/ui/feedback/Banner'
import { useToast } from '@/components/ui/feedback/useToast'
import { copyFor, fieldErrorsFrom } from '@/lib/api/error-copy'
import { isAbortError } from '@/lib/api/errors'
import type { SettingsDto, SettingsPatch } from '@/lib/api/types/admin/settings'
import { useZodForm } from '@/lib/forms/useZodForm'
import { buildPatch } from '@/features/admin/settings/settings-diff'
import { useSaveSettings } from '@/features/admin/settings/useAdminSettings'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/query/keys'

type EditableGroup = Exclude<keyof SettingsPatch, 'version'>

interface SettingsFormProps<T extends FieldValues> {
  group: EditableGroup
  dto: SettingsDto
  schema: ZodType<T, T>
  /** Values for the form, taken from the server DTO of this group. */
  pick: (dto: SettingsDto) => T
  onDirtyChange: (dirty: boolean) => void
  children: (form: UseFormReturn<T, unknown, T>) => ReactNode
}

/**
 * Shared form core for every editable settings group (PLAN-005 TASK-005/008). Validates with the group's Zod schema,
 * sends only changed fields plus the loaded `version`, and handles VERSION_CONFLICT and VALIDATION_FAILED.
 */
export function SettingsForm<T extends FieldValues>({
  group,
  dto,
  schema,
  pick,
  onDirtyChange,
  children,
}: SettingsFormProps<T>) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const save = useSaveSettings()
  const form = useZodForm<T>(schema, { defaultValues: pick(dto) as never })
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const dirty = form.formState.isDirty

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const submit = form.handleSubmit(async (values) => {
    setSaveError(null)
    const server = dto
    const patch = buildPatch(group, server.version, pick(server), values)
    if (patch === null) {
      form.reset(values)
      return
    }
    try {
      const next = await save.mutateAsync(patch)
      setConflict(false)
      form.reset(pick(next) as never)
      toast.success('Settings saved')
    } catch (error: unknown) {
      if (isAbortError(error)) return
      if (isVersionConflict(error)) {
        setConflict(true)
        await queryClient.refetchQueries({ queryKey: qk.admin.settings() })
        return
      }
      const prefix = `${group}.`
      const mapped = Object.entries(fieldErrorsFrom(error)).filter(([key]) => key.startsWith(prefix))
      for (const [key, messages] of mapped) {
        form.setError(key.slice(prefix.length) as Path<T>, { type: 'server', message: messages[0] })
      }
      if (mapped.length === 0) setSaveError(error)
    }
  })

  const errorCopy = saveError === null ? null : copyFor(saveError, { action: 'save settings' })

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void submit(event)
      }}
      className="grid gap-5"
    >
      {conflict ? (
        <Banner tone="warning" title="Settings changed elsewhere" live="alert">
          Someone else saved settings while you were editing. Your edits are still shown. Review them and save again, or
          reload the latest values.
        </Banner>
      ) : null}
      {errorCopy === null ? null : (
        <Banner tone="danger" title={errorCopy.title} live="alert">
          {errorCopy.body}
        </Banner>
      )}
      {children(form)}
      <SaveBar
        dirty={dirty}
        saving={save.isPending}
        onSave={() => {
          void submit()
        }}
        onDiscard={() => {
          form.reset(pick(dto) as never)
          setConflict(false)
          setSaveError(null)
        }}
      />
    </form>
  )
}
