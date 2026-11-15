'use client'

import { useRef, useState } from 'react'
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
import type { AdminPlayerDto } from '@/lib/api/types/admin/players'

const PASSWORD_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generatePassword(length = 14): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => PASSWORD_ALPHABET.charAt(b % PASSWORD_ALPHABET.length)).join('')
}

/**
 * Admin sets a new temporary password for a player. The player is signed out everywhere and must change it at next
 * sign-in. Needs a step-up token and an idempotency key; the admin shares the password out of band.
 */
export function ResetPasswordDialog({ player }: { player: AdminPlayerDto }) {
  const api = useApi()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [fieldError, setFieldError] = useState<string | undefined>()
  const [dialogError, setDialogError] = useState<string | undefined>()
  const [copied, setCopied] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const canSubmit = password.trim() !== ''

  function openDialog(): void {
    setPassword(generatePassword())
    setFieldError(undefined)
    setDialogError(undefined)
    setCopied(false)
    setOpen(true)
  }

  function handleClose(next: boolean): void {
    if (isPending) return
    setOpen(next)
  }

  function handleCopy(): void {
    if (!canSubmit) return
    navigator.clipboard.writeText(password).then(
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
    setFieldError(undefined)
    setDialogError(undefined)
    const intentKey = newIdempotencyKey()

    // Not a transition: the step-up prompt opens from inside this call and React would hold its update until we finish.
    setIsPending(true)
    withStepUpToken((stepUp) =>
      api.admin.players.resetPlayerPassword(player.id, { password }, intentKey, { stepUp }),
    ).then(
      () => {
        setIsPending(false)
        setOpen(false)
        pushToast('success', `Password reset for ${player.name}. Share the temporary password with them.`)
      },
      (error: unknown) => {
        setIsPending(false)
        if (isAbortError(error)) return
        if (isApiError(error) && error.code === 'VALIDATION_FAILED') {
          const message = fieldErrorsFrom(error).password?.[0]
          if (message !== undefined) {
            setFieldError(message)
            return
          }
        }
        const copy = copyFor(error, { action: 'reset this password' })
        setDialogError(`${copy.title} ${copy.body}`)
      },
    )
  }

  return (
    <>
      <Button variant="secondary" onClick={openDialog} className="justify-self-start">
        Reset password
      </Button>

      <Dialog
        open={open}
        onOpenChange={handleClose}
        title={`Reset password for ${player.name}`}
        descriptionText="Sets a new temporary password. The player is signed out of all sessions and must change it at next sign-in. Share it with them out of hand. You will be asked for your password."
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
              loadingLabel="Resetting password…"
            >
              Reset password
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {dialogError !== undefined ? (
            <Banner tone="danger" title="Could not reset password" live="alert">
              {dialogError}
            </Banner>
          ) : null}

          <Field
            label="Temporary password"
            required
            error={fieldError}
            hint="Copy it before closing this dialog. It cannot be viewed again."
          >
            <div className="flex min-w-0 items-start gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  type="text"
                  value={password}
                  maxLength={128}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={isPending}
                  onChange={(e) => {
                    setPassword(e.target.value)
                  }}
                />
              </div>
              <div className="flex shrink-0 gap-1 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    setPassword(generatePassword())
                    setCopied(false)
                  }}
                >
                  Generate
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  aria-label="Copy temporary password to clipboard"
                  disabled={!canSubmit || isPending}
                  onClick={handleCopy}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </div>
          </Field>
        </div>
      </Dialog>
    </>
  )
}
