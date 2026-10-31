'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import type { SettingsDto, SettingsPatch } from '@/lib/api/types/admin/settings'
import { qk } from '@/lib/query/keys'
import { adminSettingsQuery } from '@/lib/query/query-options/admin'

/** Settings read (G07). */
export function useAdminSettings() {
  const api = useApi()
  return useQuery(adminSettingsQuery(api.admin))
}

/** Settings partial save (G08). The PATCH response is the full DTO and replaces the cached copy. */
export function useSaveSettings() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation<SettingsDto, unknown, SettingsPatch>({
    mutationFn: (patch) => api.admin.settings.updateSettings(patch),
    onSuccess: (dto) => {
      queryClient.setQueryData(qk.admin.settings(), dto)
      void queryClient.invalidateQueries({ queryKey: qk.admin.settings() })
    },
  })
}
