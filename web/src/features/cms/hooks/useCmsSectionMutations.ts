'use client'

import { useQueryClient } from '@tanstack/react-query'
import { conflictFromLastChange, isVersionConflict, type ConflictInfo } from '@/components/admin/versionConflict'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import type {
  AdminLegalPageDto,
  CmsSectionDto,
  PublishCmsResult,
  PublishLegalResult,
  SaveCmsDraftInput,
  SaveCmsDraftResult,
  SaveLegalDraftInput,
} from '@/lib/api/types/admin/cms'
import type { LegalPage } from '@/lib/api/types/legal-sitemap'
import type { SiteSection } from '@/lib/api/types/site-content'
import { qk } from '@/lib/query/keys'
import { useApiMutation } from '@/lib/query/mutation'
import { adminCmsSectionQuery, adminLegalPageQuery } from '@/lib/query/query-options/admin'

// CMS-F1: write hooks for site sections (S03, S04) and legal pages (S06). All go through useApiMutation, so a publish
// keeps ONE Idempotency-Key per intent (reused on retry, new after success). Saving never publishes.
//
// VERSION_CONFLICT: the error body has no slot for the other editor, so the hook re-reads the resource and reports its
// `lastChange` through `onConflict` (a typed ConflictInfo for SaveBar). The caller keeps its local edits until the user
// chooses to reload; nothing is overwritten here.
//
// Legal publish confirm (CMS-F5): these hooks only expose `mutate`. The page opens its ConfirmDialog first and calls
// `publish.mutate(...)` from the dialog onConfirm, so the hook needs no change to be wrapped.

export interface ConflictHandlers {
  onConflict?: (info: ConflictInfo) => void
}

/** Save a section draft (S03). Stale `version` -> VERSION_CONFLICT -> re-read + `onConflict`. */
export function useSaveSectionDraft(key: SiteSection, handlers: ConflictHandlers = {}) {
  const api = useApi().admin
  const queryClient = useQueryClient()
  return useApiMutation<SaveCmsDraftResult, SaveCmsDraftInput>({
    idempotent: false,
    mutationFn: (input) => api.cms.saveSectionDraft(input),
    invalidates: () => [qk.admin.cmsSection(key), qk.admin.cms()],
    onError: (error) => {
      if (!isVersionConflict(error)) return
      void queryClient.fetchQuery({ ...adminCmsSectionQuery(api, key), staleTime: 0 }).then(
        (section: CmsSectionDto) => handlers.onConflict?.(conflictFromLastChange(section.lastChange)),
        () => handlers.onConflict?.(conflictFromLastChange(null)),
      )
    },
  })
}

export interface PublishSectionVars {
  key: SiteSection
  version: CmsSectionDto['version']
}

/** Publish the saved section draft (S04). Idempotency-Key per intent. */
export function usePublishSection(handlers: ConflictHandlers = {}) {
  const api = useApi().admin
  const queryClient = useQueryClient()
  return useApiMutation<PublishCmsResult, PublishSectionVars>({
    mutationFn: ({ key, version }, { idempotencyKey }) => {
      if (idempotencyKey === null) throw new Error('Publish needs an idempotency key')
      return api.cms.publishSection(key, version, idempotencyKey)
    },
    invalidates: ({ key }) => [qk.admin.cmsSection(key), qk.admin.cmsVersions(key), qk.admin.cms()],
    onError: (error, { key }) => {
      if (!isVersionConflict(error)) return
      void queryClient.fetchQuery({ ...adminCmsSectionQuery(api, key), staleTime: 0 }).then(
        (section: CmsSectionDto) => handlers.onConflict?.(conflictFromLastChange(section.lastChange)),
        () => handlers.onConflict?.(conflictFromLastChange(null)),
      )
    },
  })
}

export interface SaveLegalVars {
  page: LegalPage
  input: SaveLegalDraftInput
}

/** Save a legal page draft (S06 PUT). */
export function useSaveLegalDraft(handlers: ConflictHandlers = {}) {
  const api = useApi().admin
  const queryClient = useQueryClient()
  return useApiMutation<AdminLegalPageDto, SaveLegalVars>({
    idempotent: false,
    mutationFn: ({ page, input }) => api.cms.saveLegalDraft(page, input),
    invalidates: ({ page }) => [qk.admin.legalPage(page), qk.admin.cms()],
    onError: (error, { page }) => {
      if (!isVersionConflict(error)) return
      void queryClient.fetchQuery({ ...adminLegalPageQuery(api, page), staleTime: 0 }).then(
        (legal: AdminLegalPageDto) => handlers.onConflict?.(conflictFromLastChange(legal.lastChange)),
        () => handlers.onConflict?.(conflictFromLastChange(null)),
      )
    },
  })
}

export interface PublishLegalVars {
  page: LegalPage
  version: AdminLegalPageDto['version']
}

/** Publish a legal page (S06). Wrap in the "This is a legal page, are you sure?" confirm at the call site (CMS-F5). */
export function usePublishLegalPage(handlers: ConflictHandlers = {}) {
  const api = useApi().admin
  const queryClient = useQueryClient()
  return useApiMutation<PublishLegalResult, PublishLegalVars>({
    mutationFn: ({ page, version }, { idempotencyKey }) => {
      if (idempotencyKey === null) throw new Error('Publish needs an idempotency key')
      return api.cms.publishLegalPage(page, version, idempotencyKey)
    },
    invalidates: ({ page }) => [qk.admin.legalPage(page), qk.admin.cms()],
    onError: (error, { page }) => {
      if (!isVersionConflict(error)) return
      void queryClient.fetchQuery({ ...adminLegalPageQuery(api, page), staleTime: 0 }).then(
        (legal: AdminLegalPageDto) => handlers.onConflict?.(conflictFromLastChange(legal.lastChange)),
        () => handlers.onConflict?.(conflictFromLastChange(null)),
      )
    },
  })
}
