import { describe, expect, it } from 'vitest'
import {
  attendanceRatio,
  attendanceText,
  parseSelectedId,
  ratingDetail,
  ratingText,
  toSearchQuery,
} from '@/features/admin/players/players-labels'
import { adminPlayerRowSchema, adminPlayerSchema } from '@/lib/api/types/admin/players'

const ID = '3f2b8c1e-5a47-4d0e-9c1a-7b6e2d4f8a90'
const NOW = '2026-11-01T10:00:00+05:30'

const row = {
  id: ID,
  name: 'Asha K',
  email: 'asha@example.com',
  city: null,
  role: 'player',
  status: 'active',
  eventsAttended: 0,
  joinedAt: NOW,
  rating: null,
  attendancePct: null,
}

const record = {
  ...row,
  registered: 0,
  historyTruncated: false,
  nextEvent: null,
  phone: null,
  birthday: null,
  area: null,
  chessComHandle: null,
  fideId: null,
  visibleFields: ['phone', 'birthday', 'area', 'chessComHandle', 'fideId'],
  history: [],
  ratings: [],
  canChangeRole: { allowed: true },
  version: 1,
}

describe('admin players schemas', () => {
  it('parses a newcomer row (no rating, no attendance, no city)', () => {
    expect(adminPlayerRowSchema.safeParse(row).success).toBe(true)
  })

  it('parses a rated row and bounds attendance', () => {
    const rated = { ...row, rating: { pool: 'rapid', rating: 1286, provisional: false }, attendancePct: 89 }
    expect(adminPlayerRowSchema.safeParse(rated).success).toBe(true)
    expect(adminPlayerRowSchema.safeParse({ ...rated, attendancePct: 101 }).success).toBe(false)
  })

  it('accepts empty strings the backend can return', () => {
    expect(adminPlayerRowSchema.safeParse({ ...row, name: '', email: '' }).success).toBe(true)
    const withEmptyTitle = {
      ...record,
      history: [
        {
          registrationId: ID,
          eventId: ID,
          eventSlug: '',
          eventTitle: '',
          startsAt: NOW,
          status: 'confirmed',
          attended: true,
        },
      ],
    }
    expect(adminPlayerSchema.safeParse(withEmptyTitle).success).toBe(true)
  })

  it('parses a full record with RD, next event and a loosely formatted phone', () => {
    const full = {
      ...record,
      phone: '98765 43210',
      birthday: '1990-04-02',
      ratings: [{ pool: 'rapid', rating: 1286, rd: 71, games: 24, provisional: false }],
      registered: 9,
      nextEvent: { id: ID, slug: 'monsoon-open', title: 'Monsoon Open', startsAt: NOW },
      canChangeRole: { allowed: false, reason: 'You cannot change your own role.' },
    }
    expect(adminPlayerSchema.safeParse(full).success).toBe(true)
  })

  it('rejects a record without the new fields', () => {
    const partial: Record<string, unknown> = { ...record }
    delete partial.nextEvent
    expect(adminPlayerSchema.safeParse(partial).success).toBe(false)
  })
})

describe('players helpers', () => {
  it('shows "New" for unrated and provisional players', () => {
    expect(ratingText(null)).toBe('New')
    expect(ratingText({ pool: 'rapid', rating: 1500, provisional: true })).toBe('New')
    expect(ratingText({ pool: 'rapid', rating: 1286, provisional: false })).toBe('1286 Rapid')
  })

  it('formats rating detail with RD', () => {
    expect(ratingDetail({ pool: 'rapid', rating: 1286, rd: 71, games: 24, provisional: false })).toBe(
      '1286 \u00b7 RD 71',
    )
  })

  it('never invents attendance', () => {
    expect(attendanceText(null)).toBe('\u2014')
    expect(attendanceText(0)).toBe('0%')
    expect(attendanceRatio(8, 9)).toBe('8/9')
    expect(attendanceRatio(0, 0)).toBe('\u2014')
  })

  it('sends the raw trimmed search, capped, and nothing when empty', () => {
    expect(toSearchQuery('  +91 98765-43210 ')).toBe('+91 98765-43210')
    expect(toSearchQuery('   ')).toBeUndefined()
    expect(toSearchQuery('a'.repeat(150))).toHaveLength(100)
  })

  it('accepts only id-shaped selections', () => {
    expect(parseSelectedId(ID)).toBe(ID)
    expect(parseSelectedId('../../x')).toBeNull()
    expect(parseSelectedId(null)).toBeNull()
  })
})
