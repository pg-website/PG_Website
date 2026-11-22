import type { Route } from 'next'
import type { AdminEventRowDto } from '@/lib/api/types/admin/event-list'

export const eventHref = (id: string, suffix = ''): Route => `/admin/events/${encodeURIComponent(id)}${suffix}` as Route

/** A draft can have no title yet; the list shows a placeholder instead of a blank cell. */
export const rowTitle = (row: AdminEventRowDto): string => (row.title.trim() === '' ? 'Untitled draft' : row.title)
