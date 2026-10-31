'use client'

import { useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/overlay/Dialog'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called when the confirm button is pressed. The caller closes the dialog when the work is done. */
  onConfirm: () => void
  title: string
  /** What will happen, in plain words ("This cancels 3 bookings and cannot be undone."). Also the accessible description. */
  consequence: string
  /** Optional extra content between the consequence and the buttons (a list of affected items). */
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive uses the copper button; otherwise primary. */
  destructive?: boolean
  /** The request is running: confirm shows a spinner and is blocked, cancel and dismissal are blocked. */
  loading?: boolean
  loadingLabel?: string
}

/**
 * Confirm / destructive pattern (admin cancel, refund, delete). A Radix `alertdialog`: focus starts on the SAFE action
 * (Cancel), never on the destructive one; Escape and outside click dismiss it unless a request is running. While
 * `loading` the dialog cannot be dismissed and confirm cannot fire twice (Button blocks `onClick`).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  consequence,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  loadingLabel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!loading) onOpenChange(next)
      }}
      title={title}
      descriptionText={consequence}
      size="md"
      role="alertdialog"
      dismissible={!loading}
      initialFocusRef={cancelRef}
      footer={
        <>
          <button
            ref={cancelRef}
            type="button"
            aria-disabled={loading || undefined}
            onClick={loading ? undefined : () => onOpenChange(false)}
            className="inline-flex min-h-control min-w-0 items-center justify-center rounded-public border border-forest bg-transparent px-6 py-3 text-center type-button text-forest hover:bg-line"
          >
            {cancelLabel}
          </button>
          <Button
            variant={destructive ? 'copper' : 'primary'}
            size="lg"
            loading={loading}
            loadingLabel={loadingLabel}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}
