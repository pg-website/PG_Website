'use client'

import { useState, useTransition } from 'react'
import { Banner } from '@/components/ui/feedback/Banner'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/form/Field'
import { Input } from '@/components/ui/form/Input'
import { pushToast } from '@/components/ui/feedback/toastStore'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { copyFor, fieldErrorsFrom } from '@/lib/api/error-copy'
import { isAbortError, isApiError } from '@/lib/api/errors'

// PLAN-012 TASK-211. Full-page, non-dismissable gate for admin-created accounts that must change their password.
// Rules: rule 5.4 (no sub-components), rule 6.11 (useTransition), rule 6.9 (ternary conditionals).

export interface MustChangePasswordGateProps {
  user: { name: string; email: string; mustChangePassword: boolean }
  /** Called after the password is changed and all sessions are revoked. The parent should clear auth and redirect. */
  onLoggedOut: () => void
}

type FormErrors = {
  currentPassword?: string
  newPassword?: string
  confirmPassword?: string
  dialogLevel?: string
}

/** Empty form initial state; used as the lazy initial value. */
function emptyForm() {
  return { currentPassword: '', newPassword: '', confirmPassword: '' }
}

/**
 * Full-page gate shown when the signed-in user has `mustChangePassword === true`.
 * The user cannot navigate past this screen until they set a new password.
 * On success the backend revokes all sessions; the frontend clears local auth state via `onLoggedOut`.
 */
export function MustChangePasswordGate({ onLoggedOut }: MustChangePasswordGateProps) {
  const api = useApi()
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState<FormErrors>({})
  const [isPending, startTransition] = useTransition()

  function handleSubmit(): void {
    // Client-side: check new password matches confirm
    if (form.newPassword !== form.confirmPassword) {
      setErrors({ confirmPassword: 'Passwords do not match.' })
      return
    }
    if (form.currentPassword.trim() === '' || form.newPassword.trim() === '') {
      return
    }

    setErrors({})

    startTransition(async () => {
      try {
        await api.player.me.changePassword({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
        })
        // The backend revokes all sessions on success. Show a toast then hand off to the parent.
        pushToast('success', 'Password changed. Please log in with your new password.')
        onLoggedOut()
      } catch (error) {
        if (isAbortError(error)) return
        if (isApiError(error) && error.code === 'VALIDATION_FAILED') {
          const fields = fieldErrorsFrom(error)
          if (fields.currentPassword !== undefined || fields.newPassword !== undefined) {
            setErrors({
              currentPassword: fields.currentPassword?.[0],
              newPassword: fields.newPassword?.[0],
            })
            return
          }
        }
        if (isApiError(error) && error.code === 'WEAK_PASSWORD') {
          setErrors({ newPassword: 'That password is too weak. Choose a stronger one.' })
          return
        }
        const copy = copyFor(error, { action: 'change your password' })
        setErrors({ dialogLevel: `${copy.title} ${copy.body}` })
      }
    })
  }

  const canSubmit =
    form.currentPassword.trim() !== '' && form.newPassword.trim() !== '' && form.confirmPassword.trim() !== ''

  return (
    <div className="flex min-h-dvh items-center justify-center px-gutter py-safe-12">
      <div className="w-full max-w-md min-w-0">
        <div className="grid gap-6">
          <div className="grid gap-2">
            <h1 className="font-display text-section">Set your new password</h1>
            <p className="text-body text-ink-soft">
              Your account was created by an admin with a temporary password. You must set a new password to continue.
            </p>
          </div>

          {errors.dialogLevel !== undefined ? (
            <Banner tone="danger" title="Could not change password" live="alert">
              {errors.dialogLevel}
            </Banner>
          ) : null}

          <div className="grid gap-4">
            <Field label="Temporary password" required error={errors.currentPassword}>
              <Input
                type="password"
                value={form.currentPassword}
                maxLength={128}
                autoComplete="current-password"
                disabled={isPending}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, currentPassword: e.target.value }))
                }}
              />
            </Field>

            <Field label="New password" required error={errors.newPassword}>
              <Input
                type="password"
                value={form.newPassword}
                maxLength={128}
                autoComplete="new-password"
                disabled={isPending}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, newPassword: e.target.value }))
                }}
              />
            </Field>

            <Field label="Confirm new password" required error={errors.confirmPassword}>
              <Input
                type="password"
                value={form.confirmPassword}
                maxLength={128}
                autoComplete="new-password"
                disabled={isPending}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, confirmPassword: e.target.value }))
                }}
              />
            </Field>
          </div>

          <Button
            variant="primary"
            fullWidth
            onClick={handleSubmit}
            disabled={!canSubmit || isPending}
            loading={isPending}
            loadingLabel="Setting password…"
          >
            Set password
          </Button>
        </div>
      </div>
    </div>
  )
}
