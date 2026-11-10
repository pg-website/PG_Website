'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { EmptyState } from '@/components/ui/feedback/EmptyState'
import { Heading } from '@/components/ui/Heading'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Surface } from '@/components/ui/Surface'
import { Text } from '@/components/ui/Text'
import { ResponsiveTable } from '@/components/ui/table/ResponsiveTable'
import type { TableColumn } from '@/components/ui/table/tableTypes'
import { ChangeRoleAction } from '@/features/admin/players/ChangeRoleAction'
import { EnrollInEventDialog } from '@/features/admin/players/EnrollInEventDialog'
import { PlayerFact as Fact } from '@/features/admin/players/PlayerFact'
import {
  attendanceRatio,
  HISTORY_STATUS_LABEL,
  POOL_LABEL,
  PRIVATE_FIELD_LABEL,
  ratingDetail,
  ROLE_LABEL,
  ROLE_TONE,
  STATUS_LABEL,
  STATUS_TONE,
} from '@/features/admin/players/players-labels'
import type { AdminPlayerDto, PermittedPrivateField, PlayerEventHistoryRow } from '@/lib/api/types/admin/players'
import type { UserRole } from '@/lib/api/types/auth'
import { formatEventDate, formatEventDateTime } from '@/lib/format/date'

const eventHref = (id: string): Route => `/admin/events/${encodeURIComponent(id)}` as Route

const HISTORY_COLUMNS: readonly TableColumn<PlayerEventHistoryRow>[] = [
  {
    id: 'event',
    header: 'Event',
    rowHeader: true,
    priority: 'primary',
    cell: (row) => (row.eventTitle.trim() === '' ? 'Untitled event' : row.eventTitle),
  },
  { id: 'date', header: 'Date', priority: 'primary', cell: (row) => formatEventDate(row.startsAt) },
  {
    id: 'status',
    header: 'Registration',
    priority: 'primary',
    cell: (row) => HISTORY_STATUS_LABEL[row.status],
  },
  { id: 'attended', header: 'Attended', cell: (row) => (row.attended ? 'Yes' : 'No') },
]

function formatBirthday(value: string): string {
  // A calendar date has no zone: read it at IST midnight so the IST formatter keeps the same day.
  return formatEventDate(`${value}T00:00:00+05:30`, { weekday: 'none' })
}

/** A private field: hidden for the role, not provided by the player, or the value (as text, never HTML). */
function privateValue(player: AdminPlayerDto, field: PermittedPrivateField): string {
  if (!player.visibleFields.includes(field)) return 'Not visible to your role'
  const value = player[field]
  if (value === null) return 'Not provided'
  return field === 'birthday' ? formatBirthday(value) : value
}

export function PlayerRecordBody({ player, onRoleChanged }: { player: AdminPlayerDto; onRoleChanged: (role: UserRole) => void }) {
  const headingRef = useRef<HTMLDivElement>(null)
  const id = player.id

  // On narrow screens the detail replaces the list, so move focus to its heading when a player opens.
  useEffect(() => {
    if (window.matchMedia('(max-width: 1023px)').matches) headingRef.current?.focus()
  }, [id])

  const privateFields = Object.keys(PRIVATE_FIELD_LABEL) as PermittedPrivateField[]

  return (
    <div className="grid gap-6">
      <div ref={headingRef} tabIndex={-1} className="grid gap-2 outline-none">
        <Heading level={2} size="panel">
          {player.name}
        </Heading>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={ROLE_TONE[player.role]}>{ROLE_LABEL[player.role]}</StatusBadge>
          <StatusBadge tone={STATUS_TONE[player.status]}>{STATUS_LABEL[player.status]}</StatusBadge>
        </div>
      </div>

      <Surface as="section" tone="admin" aria-labelledby="player-profile">
        <Heading level={3} id="player-profile">
          Profile
        </Heading>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Fact label="Email">{player.email === '' ? 'Not provided' : player.email}</Fact>
          <Fact label="City">{player.city ?? 'Not provided'}</Fact>
          <Fact label="Joined">{formatEventDate(player.joinedAt)}</Fact>
          <Fact label="Next event">
            {player.nextEvent === null ? (
              'None booked'
            ) : (
              <>
                <Link href={eventHref(player.nextEvent.id)} className="underline">
                  {player.nextEvent.title.trim() === '' ? 'Untitled event' : player.nextEvent.title}
                </Link>
                <span className="block text-sm text-ink-soft">{formatEventDateTime(player.nextEvent.startsAt)}</span>
              </>
            )}
          </Fact>
          <Fact label="Attendance">
            {attendanceRatio(player.eventsAttended, player.registered)}
            {player.registered > 0 ? <span className="text-sm text-ink-soft"> events attended</span> : null}
          </Fact>
        </dl>
      </Surface>

      <Surface as="section" tone="admin" aria-labelledby="player-ratings">
        <Heading level={3} id="player-ratings">
          PG ratings
        </Heading>
        {player.ratings.length === 0 ? (
          <Text variant="small" className="mt-2">
            Not rated yet.
          </Text>
        ) : (
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            {player.ratings.map((rating) => (
              <Fact key={rating.pool} label={`${POOL_LABEL[rating.pool]} (${String(rating.games)} games)`}>
                {ratingDetail(rating)}
              </Fact>
            ))}
          </dl>
        )}
      </Surface>

      <Surface as="section" tone="admin" aria-labelledby="player-private">
        <Heading level={3} id="player-private">
          Private details
        </Heading>
        <Text variant="small" className="mt-1">
          Only admins see these. Opening this record is logged.
        </Text>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          {privateFields.map((field) => (
            <Fact key={field} label={PRIVATE_FIELD_LABEL[field]}>
              {privateValue(player, field)}
            </Fact>
          ))}
        </dl>
      </Surface>

      <Surface as="section" tone="admin" aria-labelledby="player-role">
        <Heading level={3} id="player-role">
          Role
        </Heading>
        <div className="mt-4">
          <ChangeRoleAction key={`${player.id}-${player.role}`} player={player} onChanged={onRoleChanged} />
        </div>
      </Surface>

      {player.status === 'active' ? (
        <Surface as="section" tone="admin" aria-labelledby="player-actions">
          <Heading level={3} id="player-actions">
            Actions
          </Heading>
          <div className="mt-4">
            <EnrollInEventDialog player={player} />
          </div>
        </Surface>
      ) : null}

      <section aria-labelledby="player-history" className="grid gap-3">
        <Heading level={3} id="player-history">
          Event history
        </Heading>
        {player.historyTruncated ? (
          <Text variant="small">Showing the most recent {player.history.length} registrations.</Text>
        ) : null}
        <ResponsiveTable
          caption={`Event history for ${player.name}`}
          columns={HISTORY_COLUMNS}
          rows={player.history}
          getRowId={(row) => row.registrationId}
          rowHref={(row) => eventHref(row.eventId)}
          empty={
            <EmptyState framed={false} title="No events yet">
              This player has not registered for an event.
            </EmptyState>
          }
        />
      </section>
    </div>
  )
}

