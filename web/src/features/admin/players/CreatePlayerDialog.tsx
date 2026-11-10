'use client'

import { useRef, useState, useTransition } from 'react'
import { Banner } from '@/components/ui/feedback/Banner'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/overlay/Dialog'
import { Field } from '@/components/ui/form/Field'
import { Input } from '@/components/ui/form/Input'
import { pushToast } from '@/components/ui/feedback/toastStore'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { withStepUpToken } from '@/lib/api/browser/step-up-prompt'
import { copyFor, fieldErrorsFrom } from '@/lib/api/error-copy'
import { isAbortError, isApiError } from '@/lib/api/errors'
import { newIdempotencyKey } from '@/lib/api/idempotency'

// PLAN-012 TASK-210. Create a player account with a temporary password. Admin-only.
// Rules: rule 5.4 (no sub-components), rule 5.12 (lazy state init), rule 6.11 (useTransition), rule 6.9 (ternary conditionals).

interface CreatePlayerDialogProps {
  /** Called when the dialog opens (so the parent can update the button state if needed). */
  onCreated?: () => void
}

type FormErrors = {
  name?: string
  email?: string
  password?: string
  dialogLevel?: string
}

/** A fresh, empty form state. Used as the lazy initial value and for reset. */
function emptyForm() {
  return { name: '', email: '', password: '', city: '', phone: '' }
}

/**
 * Dialog that allows an admin to create a new player account with a temporary password.
 * Requires a step-up token and an idempotency key. On success the players list is invalidated
 * and a toast is shown.
 */
export function CreatePlayerDialog({ onCreated }: CreatePlayerDialogProps) {
  const api = useApi()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState<FormErrors>({})
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const canSubmit = form.name.trim() !== '' && form.email.trim() !== '' && form.password.trim() !== ''

  function openDialog(): void {
    setForm(emptyForm())
    setErrors({})
    setCopied(false)
    setOpen(true)
  }

  function handleClose(next: boolean): void {
    if (isPending) return // block dismiss while submitting
    setOpen(next)
  }

  function handleCopyPassword(): void {
    if (form.password.trim() === '') return
    navigator.clipboard.writeText(form.password).then(
      () => {
        setCopied(true)
        if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current)
        copyTimerRef.current = setTimeout(() => {
          setCopied(false)
        }, 2000)
      },
      () => {
        // clipboard write rejected (non-secure context, permissions denied)
      },
    )
  }

  function handleSubmit(): void {
    if (!canSubmit) return
    setErrors({})
    const intentKey = newIdempotencyKey()

    startTransition(async () => {
      try {
        await withStepUpToken((stepUp) =>
          api.admin.players.createPlayer(
            {
              name: form.name.trim(),
              email: form.email.trim(),
              password: form.password,
              ...(form.city.trim() !== '' ? { city: form.city.trim() } : {}),
              ...(form.phone.trim() !== '' ? { phone: form.phone.trim() } : {}),
            },
            intentKey,
            { stepUp },
          ),
        )
        setOpen(false)
        pushToast('success', 'Player created — share the temporary password with them.')
        onCreated?.()
      } catch (error) {
        if (isAbortError(error)) return
        if (isApiError(error) && error.code === 'VALIDATION_FAILED') {
          const fields = fieldErrorsFrom(error)
          if (fields.email !== undefined || fields.password !== undefined) {
            setErrors({
              email: fields.email?.[0],
              password: fields.password?.[0],
            })
            return
          }
        }
        const copy = copyFor(error, { action: 'create this player' })
        setErrors({ dialogLevel: `${copy.title} ${copy.body}` })
      }
    })
  }

  return (
    <>
      <Button variant="primary" onClick={openDialog}>
        Create player
      </Button>

      <Dialog
        open={open}
        onOpenChange={handleClose}
        title="Create player"
        descriptionText="Create a new player account with a temporary password. Share the password with them out of band (e.g. in person or via a secure message). They will be asked to change it on first login."
        dismissible={!isPending}
        footer={
          <>
            <Button variant="ghost" onClick={() => handleClose(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={!canSubmit || isPending}
              loading={isPending}
              loadingLabel="Creating player…"
            >
              Create player
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {errors.dialogLevel !== undefined ? (
            <Banner tone="danger" title="Could not create player" live="alert">
              {errors.dialogLevel}
            </Banner>
          ) : null}

          <Field label="Name" required error={errors.name}>
            <Input
              type="text"
              value={form.name}
              maxLength={80}
              autoComplete="off"
              disabled={isPending}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, name: e.target.value }))
              }}
            />
          </Field>

          <Field label="Email" required error={errors.email}>
            <Input
              type="email"
              value={form.email}
              maxLength={254}
              autoComplete="off"
              disabled={isPending}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, email: e.target.value }))
              }}
            />
          </Field>

          <Field
            label="Temporary password"
            required
            error={errors.password}
            hint="The player must change this on first login. Copy it before closing this dialog."
          >
            <div className="flex min-w-0 items-start gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  type="password"
                  value={form.password}
                  maxLength={128}
                  autoComplete="new-password"
                  disabled={isPending}
                  onChange={(e) => {
                    setForm((prev) => ({ ...prev, password: e.target.value }))
                  }}
                />
              </div>
              <div className="shrink-0 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  aria-label="Copy temporary password to clipboard"
                  disabled={form.password.trim() === '' || isPending}
                  onClick={handleCopyPassword}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </div>
          </Field>

          <Field label="City" optionalLabel>
            <Input
              type="text"
              value={form.city}
              maxLength={80}
              autoComplete="off"
              disabled={isPending}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, city: e.target.value }))
              }}
            />
          </Field>

          <Field label="Phone" optionalLabel hint="Include country code, e.g. +91 98765 43210.">
            <Input
              type="tel"
              value={form.phone}
              maxLength={20}
              autoComplete="off"
              disabled={isPending}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, phone: e.target.value }))
              }}
            />
          </Field>
        </div>
      </Dialog>
    </>
  )
}
