import type { TableColumn } from '@/components/ui/table/tableTypes'
import { attendanceText, ratingText } from '@/features/admin/players/players-labels'
import type { AdminPlayerRowDto } from '@/lib/api/types/admin/players'

// Players list columns (screen 54). No email or phone in list rows: those live in the record only.

export const PLAYER_COLUMNS: readonly TableColumn<AdminPlayerRowDto>[] = [
  {
    id: 'player',
    header: 'Player',
    rowHeader: true,
    priority: 'primary',
    cell: (row) => (
      <span className="grid">
        <span>{row.name}</span>
        <span className="text-sm font-normal text-ink-soft">{row.city ?? 'Newcomer'}</span>
      </span>
    ),
  },
  { id: 'rating', header: 'PG rating', priority: 'primary', cell: (row) => ratingText(row.rating) },
  { id: 'events', header: 'Events', align: 'end', priority: 'primary', cell: (row) => row.eventsAttended },
  {
    id: 'attendance',
    header: 'Attendance',
    align: 'end',
    priority: 'secondary',
    cell: (row) => attendanceText(row.attendancePct),
  },
]
