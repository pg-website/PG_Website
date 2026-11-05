import type { Metadata } from 'next'
import { AuthLayout, type AuthStoryCopy } from '@/components/layout/AuthLayout'
import { Eyebrow } from '@/components/ui/Eyebrow'
import { Heading } from '@/components/ui/Heading'
import { Text } from '@/components/ui/Text'
import { Banner } from '@/components/ui/feedback/Banner'
import { LoginForm } from '@/features/auth/LoginForm'
import { RedirectIfAuthed } from '@/features/auth/RedirectIfAuthed'
import { SignupForm } from '@/features/auth/SignupForm'

// Screens 13 (TASK-050) and 14 (TASK-051, `?mode=signup`). noindex and dynamic rendering come from the (auth) layout, so
// reading searchParams is allowed here. The shell stays a Server Component; the form is the only client island. Any
// mode other than `signup` renders the Login form.

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function isSignup(params: Awaited<SearchParams>): boolean {
  return firstValue(params.mode) === 'signup'
}

/** Reference screen 14 (`.auth-static__story`). */
const SIGNUP_STORY: AuthStoryCopy = {
  headline: 'Good games start before the clock.',
  body: 'Your events, pairings, ratings and people in one quiet place.',
}

const LOGIN_STORY: AuthStoryCopy = {
  headline: 'Good games start before the clock.',
  body: 'Your events, pairings, ratings and people in one quiet place.',
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  return { title: isSignup(await searchParams) ? 'Create account' : 'Log in' }
}

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const returnTo = firstValue(params.returnTo)

  if (isSignup(params)) {
    return (
      <AuthLayout story={SIGNUP_STORY}>
        <div className="grid min-w-0 gap-8">
          <div className="grid min-w-0 gap-3">
            <Eyebrow>Join PG</Eyebrow>
            <Heading level={1} size="section">
              Create your My PG account.
            </Heading>
            <Text>Just enough information to get you into the right room. The rest can wait.</Text>
          </div>
          <RedirectIfAuthed returnTo={returnTo}>
            <SignupForm returnTo={returnTo} />
          </RedirectIfAuthed>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout story={LOGIN_STORY}>

      <div className="grid min-w-0 gap-8">
        <div className="grid min-w-0 gap-3">
          <Eyebrow>Welcome back</Eyebrow>
          <Heading level={1} size="section">
            Log in to My PG.
          </Heading>
          <Text>Your next game is easier when PG remembers the details.</Text>
        </div>
        {/* After a password reset (TASK-053). Static (live="none"): the reset form's toast already announced it. */}
        {firstValue(params.reset) === 'done' ? (
          <Banner tone="success">Your password has been changed. Log in with your new password.</Banner>
        ) : null}
        <RedirectIfAuthed returnTo={returnTo}>
          <LoginForm returnTo={returnTo} />
        </RedirectIfAuthed>
      </div>
    </AuthLayout>
  )
}
