import type { MeDto } from '@/lib/api/types/auth'
import type { ProfileDto } from '@/lib/api/types/profile'
import { fingerprint } from '@/lib/mock/auth/random'
import type { AuthState, MockAccount } from '@/lib/mock/auth/state'

// Account lookups and DTO projections for the mock auth backend (TASK-021). Pure functions over a state value.

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function findByEmail(state: AuthState, email: string): MockAccount | undefined {
  const wanted = normaliseEmail(email)
  return state.accounts.find((account) => account.profile.email === wanted)
}

export function findById(state: AuthState, id: string): MockAccount | undefined {
  return state.accounts.find((account) => account.id === id)
}

export function passwordMatches(account: MockAccount, password: string): boolean {
  return account.passwordFp === fingerprint(password)
}

/**
 * INFERRED: the contract does not define `profileComplete`. The mock treats name, city and phone as the minimum a
 * registration may require (`requiredProfileFields` can still ask for more per event).
 */
export function isProfileComplete(profile: ProfileDto): boolean {
  return profile.city !== null && profile.phone !== null
}

/** `GET /auth/me` projection (A05). A copy: callers may not mutate the stored account through it. */
export function toMe(account: MockAccount): MeDto {
  return {
    id: account.id,
    name: account.profile.name,
    email: account.profile.email,
    role: account.role,
    profileComplete: isProfileComplete(account.profile),
    onboardingDone: account.onboardingDone,
    city: account.profile.city,
    ratings: account.ratings.map((entry) => ({ ...entry })),
    // PLAN-012: mock accounts never require a forced password change
    mustChangePassword: false,
  }
}

/** `GET /me/profile` projection (M13). A copy. */
export function toProfile(account: MockAccount): ProfileDto {
  return { ...account.profile, publicIdentity: { ...account.profile.publicIdentity } }
}

const COMMON_PASSWORDS: readonly string[] = Object.freeze([
  'password',
  'password1',
  '12345678',
  '123456789',
  'qwertyui',
  'qwerty123',
  'iloveyou',
  'chess123',
])

/**
 * Stand-in for the server's password policy (FEAT-000 OQ-13 open): WEAK_PASSWORD for a well-known password, one repeated
 * character, or the email itself. Length is already checked by the request schema (min 8).
 */
export function isWeakPassword(password: string, email: string): boolean {
  const lower = password.toLowerCase()
  return COMMON_PASSWORDS.includes(lower) || new Set(lower).size <= 1 || lower === normaliseEmail(email)
}
