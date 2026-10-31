import type { ReactNode } from 'react'
import { AdminSidebar } from '@/components/layout/admin/AdminSidebar'
import { AdminTopBar } from '@/components/layout/admin/AdminTopBar'
import { StepUpPrompt } from '@/components/layout/admin/StepUpPrompt'

interface AdminShellProps {
  /** The page content, already wrapped in the group's single `<main>` by the layout. */
  children: ReactNode
}

/**
 * Admin frame (FE-13). 960px and up: persistent AdminSidebar; below: sticky AdminTopBar whose menu opens the drawer.
 * Mounted inside `RequireRole('admin')` (layout), so it and every admin data component render only for a signed-in user
 * whose role came from `/auth/me` (the server re-reads it again on every admin call). Hosts the step-up dialog. Admin code
 * is imported only from the (admin) group, never from (public) (depcruise m3).
 */
export function AdminShell({ children }: AdminShellProps) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <AdminSidebar />
      <AdminTopBar />
      <div className="min-w-0 flex-1 px-gutter pb-safe">{children}</div>
      <StepUpPrompt />
    </div>
  )
}
