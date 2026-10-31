'use client'

import * as RadixDialog from '@radix-ui/react-dialog'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { OverlayBackdrop } from '@/components/ui/overlay/OverlayBackdrop'
import { OverlayCloseButton } from '@/components/ui/overlay/OverlayCloseButton'
import { VisuallyHidden } from '@/components/ui/VisuallyHidden'
import { cn } from '@/lib/cn'

/** Width cap. The dialog is always the viewport width minus 2rem on a 320px phone and never wider than the cap. */
export type DialogSize = 'sm' | 'md' | 'lg'

const SIZE_CLASS: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
}

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Required: the accessible name of the dialog. */
  title: string
  /** Required: the accessible description. Set `descriptionHidden` to keep it for screen readers only. */
  descriptionText: string
  descriptionHidden?: boolean
  size?: DialogSize
  /** Optional trigger (one button element). Radix returns focus to it on close; otherwise to the previously focused element. */
  trigger?: ReactElement
  /** Action row, pinned below the scrolling body (Cancel / Save). */
  footer?: ReactNode
  /** `alertdialog` for destructive confirmation (used by ConfirmDialog). Default `dialog`. */
  role?: 'dialog' | 'alertdialog'
  /** Element focused on open. Default: the first focusable element (Radix). */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Escape, outside click and the close button dismiss it. Set false while a request runs. Default true. */
  dismissible?: boolean
  /** Accessible name of the close button. */
  closeLabel?: string
  /**
   * `sheet`: under 720px the dialog is a bottom sheet (anchored to the bottom edge, full width, safe-area padded) and
   * keeps the same focus trap, Escape and focus return. From 720px it is the normal centred dialog. Default `centre`.
   */
  presentation?: 'centre' | 'sheet'
  children?: ReactNode
}

/**
 * Modal dialog on Radix (ARCH-001 15): focus trap, Escape, scroll lock (iOS included), inert background (Radix hides
 * siblings with aria-hidden), focus returns to the trigger, content mounted only while open. Centred; the body scrolls
 * inside (`max-h-full` of the safe-area padded backdrop) with `overscroll-contain`.
 * Imported by client code outside (public) only (depcruise M3).
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  descriptionText,
  descriptionHidden = false,
  size = 'md',
  trigger,
  footer,
  role = 'dialog',
  initialFocusRef,
  dismissible = true,
  closeLabel = 'Close',
  presentation = 'centre',
  children,
}: DialogProps) {
  const block = (event: Event) => {
    if (!dismissible) event.preventDefault()
  }
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger> : null}
      <RadixDialog.Portal>
        <OverlayBackdrop>
          <RadixDialog.Content
            data-presentation={presentation}
            role={role}
            onOpenAutoFocus={(event) => {
              const target = initialFocusRef?.current
              if (target) {
                event.preventDefault()
                target.focus()
              }
            }}
            onEscapeKeyDown={block}
            onPointerDownOutside={block}
            onInteractOutside={block}
            className={cn(
              'relative flex max-h-full w-full flex-col rounded-public border border-line bg-parchment text-ink shadow-brand outline-none',
              'transition-opacity duration-control ease-brand motion-reduce:transition-none starting:opacity-0',
              SIZE_CLASS[size],
              presentation === 'sheet' &&
                'max-sm:max-w-none max-sm:self-end max-sm:rounded-b-none max-sm:border-b-0 max-sm:max-h-5/6',
            )}
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 pr-16">
              <RadixDialog.Title className="font-display text-2xl leading-snug wrap-break-word">
                {title}
              </RadixDialog.Title>
              {descriptionHidden ? (
                <VisuallyHidden>
                  <RadixDialog.Description>{descriptionText}</RadixDialog.Description>
                </VisuallyHidden>
              ) : (
                <RadixDialog.Description className="mt-2 text-body wrap-break-word">
                  {descriptionText}
                </RadixDialog.Description>
              )}
              {children ? <div className="mt-4">{children}</div> : null}
            </div>
            {footer ? (
              <div className="flex flex-col-reverse gap-3 border-t border-line p-5 sm:flex-row sm:justify-end">
                {footer}
              </div>
            ) : null}
            {dismissible ? <OverlayCloseButton label={closeLabel} /> : null}
          </RadixDialog.Content>
        </OverlayBackdrop>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
