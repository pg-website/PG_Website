import { StatusBadge } from '@/components/ui/StatusBadge'
import { Check } from '@/components/ui/icons/Check'
import type { IntegrationHealth } from '@/lib/api/types/admin/settings'
import { SectionShell } from '@/features/admin/settings/SectionShell'

const ROWS: readonly { key: keyof IntegrationHealth; label: string }[] = [
  { key: 'google', label: 'Google sign-in' },
  { key: 'razorpay', label: 'Razorpay payments' },
  { key: 'email', label: 'Email provider' },
  { key: 'whatsapp', label: 'WhatsApp provider' },
]

/** Read-only connection status (AC-68): booleans only, no values, no inputs. WhatsApp is always "Not connected". */
export function IntegrationStatus({ integrations }: { integrations: IntegrationHealth }) {
  return (
    <SectionShell title="Integrations" intro="Provider secrets are managed in the server environment.">
      <ul className="grid divide-y divide-line border border-line-admin bg-admin-panel">
        {ROWS.map(({ key, label }) => {
          const connected = integrations[key]
          return (
            <li key={key} className="flex min-h-control items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0 text-body font-semibold wrap-break-word text-ink">{label}</span>
              <StatusBadge tone={connected ? 'success' : 'neutral'} icon={connected ? <Check size="sm" /> : undefined}>
                {connected ? 'Connected' : 'Not connected'}
              </StatusBadge>
            </li>
          )
        })}
      </ul>
    </SectionShell>
  )
}
