'use client'

import { useState } from 'react'
import { ConfirmAction } from '@/components/admin/ConfirmAction'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/form/Field'
import { Select } from '@/components/ui/form/Select'
import { ROLE_LABEL } from '@/features/admin/players/players-labels'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { withStepUpToken } from '@/lib/api/browser/step-up-prompt'
import type { AdminPlayerDto } from '@/lib/api/types/admin/players'
import { USER_ROLES, type UserRole } from '@/lib/api/types/auth'
import type { IdempotencyKey } from '@/lib/api/types/primitives'

const ROLE_OPTIONS = USER_ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role] }))

/**
 * Role change (G03). Admin command: ConfirmAction (one Idempotency-Key per intent) plus a fresh step-up token. Only
 * `{ role }` is sent. Never optimistic: the parent refetches and shows the server's role. Disabled with the server's
 * reason when `canChangeRole` is off (own account, last admin); the server re-checks either way.
 * Mount with `key={player.id + player.role}` so the choice resets after a change or a different player.
 */
export function ChangeRoleAction({ player, onChanged }: { player: AdminPlayerDto; onChanged: (role: UserRole) => void }) {
  const api = useApi()
  const [role, setRole] = useState<UserRole>(player.role)
  const capability = player.canChangeRole
  const reasonId = `role-blocked-${player.id}`
  const unchanged = role === player.role

  const run = async (key: IdempotencyKey): Promise<void> => {
    await withStepUpToken((token) => api.admin.players.changeRole(player.id, { role }, key, { stepUp: token }))
  }

  return (
    <div className="grid gap-4">
      <Field label="Role" hint="Takes effect right away and signs the player out of existing sessions.">
        <Select
          options={ROLE_OPTIONS}
          value={role}
          disabled={!capability.allowed}
          onValueChange={(value) => {
            setRole(USER_ROLES.find((candidate) => candidate === value) ?? player.role)
          }}
        />
      </Field>
      {capability.allowed ? (
        <ConfirmAction
          renderTrigger={(open) => (
            <Button variant="secondary" disabled={unchanged} onClick={open} className="justify-self-start">
              Change role
            </Button>
          )}
          title={`Make ${player.name} ${role === 'admin' ? 'an admin' : 'a player'}?`}
          consequence={`${player.name} will become ${role === 'admin' ? 'an admin with full access to the admin area' : 'a player without admin access'}. They are signed out of existing sessions and must sign in again. You will be asked for your password.`}
          confirmLabel={`Make ${ROLE_LABEL[role].toLowerCase()}`}
          destructive={role === 'player'}
          actionLabel="change this role"
          onConfirm={run}
          onDone={() => {
            onChanged(role)
          }}
        />
      ) : (
        <div>
          <Button variant="secondary" disabled aria-describedby={reasonId} className="justify-self-start">
            Change role
          </Button>
          <p id={reasonId} className="mt-1 text-sm text-muted">
            {capability.reason}
          </p>
        </div>
      )}
    </div>
  )
}
