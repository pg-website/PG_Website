import type { PairingMode } from '@/lib/api/types/event-state'
import type { RoundState } from '@/lib/api/types/event-room'

export const PAIRING_MODE_LABEL: Readonly<Record<PairingMode, string>> = {
  social_balanced: 'Social, balanced',
  swiss: 'Swiss',
  round_robin: 'Round robin',
  none: 'No pairing',
}

export const ROUND_STATE_LABEL: Readonly<Record<RoundState, string>> = {
  draft: 'Draft, not shown to players',
  published: 'Published, not started',
  live: 'Live',
  completed: 'Completed',
  void: 'Void',
}
