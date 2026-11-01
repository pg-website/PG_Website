'use client'

import { describeConflict, type ConflictInfo } from '@/components/admin/versionConflict'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/overlay/Dialog'

interface ConflictDialogProps {
  conflict: ConflictInfo | null
  /** Throw away the local edits and load the other version. */
  onReload: () => void
  /** Keep the local edits and carry on from them (nothing is overwritten by this choice). */
  onKeepMine: () => void
}

/**
 * VERSION_CONFLICT dialog (CMS-F6). Nothing is overwritten here: the local copy stays in the editor until the admin
 * picks. It cannot be dismissed without a choice.
 */
export function ConflictDialog({ conflict, onReload, onKeepMine }: ConflictDialogProps) {
  const sentence = conflict === null ? 'Someone else changed this.' : describeConflict(conflict)
  return (
    <Dialog
      open={conflict !== null}
      onOpenChange={() => undefined}
      dismissible={false}
      role="alertdialog"
      title="Someone else changed this"
      descriptionText={sentence}
      footer={
        <>
          <Button variant="secondary" onClick={onKeepMine}>
            Keep my edits
          </Button>
          <Button onClick={onReload}>Load their version</Button>
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        <p className="wrap-break-word">{sentence}</p>
        <p className="text-label text-muted">
          Load their version to see what they saved; your unsaved edits are discarded. Keep my edits to carry on with
          your copy as a new edit on top of the latest version; saving it then replaces their draft.
        </p>
      </div>
    </Dialog>
  )
}
