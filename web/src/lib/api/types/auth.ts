import { z } from 'zod'
import { ratingPoolSchema } from '@/lib/api/types/identity'
import { emailSchema, httpsUrlSchema, inputText, uuidSchema } from '@/lib/api/types/primitives'

// Authentication and session DTOs (backend contract 2.4 and 3.2; ARCH-001 12). Tokens never appear in URLs, logs or errors.

export const USER_ROLES = ['player', 'admin'] as const
export const userRoleSchema = z.enum(USER_ROLES)
export type UserRole = z.infer<typeof userRoleSchema>

// ---------- Token response shapes (contract 2.4, OD-01) ----------

const accessTokenSchema = z.string().min(1).max(4096)
const refreshTokenSchema = z.string().min(1).max(4096)

/** Body mode (dev and mock): both tokens in the JSON body; the refresh token is stored by `browser/tokens.ts`. */
export const tokenPairBodySchema = z.strictObject({
  accessToken: accessTokenSchema,
  refreshToken: refreshTokenSchema,
})
export type TokenPairBody = z.infer<typeof tokenPairBodySchema>

/**
 * Cookie mode (launch): only the access token is in the body; the refresh token travels in the `__Secure-pg_rt`
 * httpOnly cookie. Strict, so a body that still carries `refreshToken` is classified as body mode, not cookie mode.
 */
export const tokenCookieBodySchema = z.strictObject({ accessToken: accessTokenSchema })
export type TokenCookieBody = z.infer<typeof tokenCookieBodySchema>

/** Either mode. `browser/tokens.ts` decides storage from which shape arrived. */
export const sessionTokensSchema = z.union([tokenPairBodySchema, tokenCookieBodySchema])
export type SessionTokens = z.infer<typeof sessionTokensSchema>

// ---------- User ----------

const ratingsSummarySchema = z.array(
  z.object({
    pool: ratingPoolSchema,
    rating: z.int().min(0).max(4000),
    games: z.int().min(0),
    provisional: z.boolean(),
  }),
)

/** `GET /auth/me` (A05, `no-store`). The role comes from the server and is never inferred client-side. */
export const meSchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(1).max(80),
  email: emailSchema,
  role: userRoleSchema,
  profileComplete: z.boolean(),
  /** First-login preferences done or skipped (screen 17). */
  onboardingDone: z.boolean(),
  city: z.string().trim().min(1).max(80).nullable(),
  ratings: ratingsSummarySchema,
  /**
   * Set to `true` for admin-created accounts until the user changes their temporary password (PLAN-012).
   * Optional so existing API responses without this field continue to parse during the deployment window.
   */
  mustChangePassword: z.boolean().optional().default(false),
})
export type MeDto = z.infer<typeof meSchema>

// ---------- Requests ----------

/**
 * Password length is policy (FEAT-000 OQ-13), enforced by the server with WEAK_PASSWORD. The 8 here is an inferred
 * client-side floor for early feedback only; the 128 cap bounds request size.
 */
export const newPasswordSchema = z.string().min(8).max(128)

export const loginInputSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) })
export type LoginInput = z.infer<typeof loginInputSchema>

export const registerInputSchema = z.object({
  name: inputText(80),
  email: emailSchema,
  password: newPasswordSchema,
  city: inputText(80).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/)
    .optional(),
})
export type RegisterInput = z.infer<typeof registerInputSchema>

/** `POST /auth/login` and `POST /auth/register` response (A01, A02): the user plus tokens in either mode. */
export const authResultSchema = z.object({ user: meSchema, tokens: sessionTokensSchema })
export type AuthResult = z.infer<typeof authResultSchema>

/** Wire form: tokens sit next to `user` in `data`. The adapter folds them into `AuthResult`. */
export const authResultWireSchema = z.union([
  z.strictObject({ user: meSchema, accessToken: accessTokenSchema, refreshToken: refreshTokenSchema }),
  z.strictObject({ user: meSchema, accessToken: accessTokenSchema }),
])
export type AuthResultWire = z.infer<typeof authResultWireSchema>

/** `POST /auth/refresh`: body mode sends the refresh token; cookie mode sends none (the cookie and the CSRF header do). */
export const refreshInputSchema = z.union([z.strictObject({ refreshToken: refreshTokenSchema }), z.strictObject({})])
export type RefreshInput = z.infer<typeof refreshInputSchema>

/** `POST /auth/logout`: body mode sends the refresh token; cookie mode sends no body. Always succeeds. */
export const logoutInputSchema = refreshInputSchema
export type LogoutInput = z.infer<typeof logoutInputSchema>

/** `POST /auth/password-reset` (A06): identical neutral 200 for known and unknown emails. */
export const passwordResetRequestSchema = z.object({ email: emailSchema })
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>

/** `POST /auth/password-reset/confirm` (A07). The token comes from the email link and is single use. */
export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1).max(512),
  newPassword: newPasswordSchema,
})
export type PasswordResetConfirm = z.infer<typeof passwordResetConfirmSchema>

/** `POST /auth/step-up` (contract 2.4): fresh access token valid for 5 minutes for one sensitive operation. */
export const stepUpInputSchema = z.object({ password: z.string().min(1).max(128) })
export const stepUpResultSchema = tokenCookieBodySchema
export type StepUpInput = z.infer<typeof stepUpInputSchema>

/** `PATCH /api/me/password` (PLAN-012). Authenticated password change; clears `mustChangePassword` and revokes all sessions. */
export const changePasswordInputSchema = z.strictObject({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
})
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>

// ---------- Google OAuth (flagged, A08 and A09) ----------

/** `GET /auth/oauth/google/start`. The adapter checks the host against the allow-list before redirecting (F-16). */
export const oauthStartSchema = z.object({ url: httpsUrlSchema })
export type OauthStart = z.infer<typeof oauthStartSchema>

/** `POST /auth/oauth/exchange`. The one-time code arrives in the callback URL and is exchanged by POST, then removed (F-10). */
export const oauthExchangeInputSchema = z.object({ code: z.string().min(1).max(512) })
export type OauthExchangeInput = z.infer<typeof oauthExchangeInputSchema>

// ---------- First-login preferences (M16, screen 17) ----------

export const PLAY_STYLES = ['figuring_out', 'mostly_online', 'club_player', 'tournament_player'] as const
export const MOODS = ['play', 'improve', 'compete', 'meet_people'] as const

export const preferencesInputSchema = z.object({
  playStyle: z.enum(PLAY_STYLES).optional(),
  mood: z.enum(MOODS).optional(),
  skipped: z.boolean().optional(),
})
export type PreferencesInput = z.infer<typeof preferencesInputSchema>
