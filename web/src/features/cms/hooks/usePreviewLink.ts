'use client'

import { useApi } from '@/lib/api/adapters/useApi.browser'
import type { CreatePreviewLinkInput, PreviewLinkDto } from '@/lib/api/types/admin/preview'
import { useApiMutation } from '@/lib/query/mutation'

/** PV01: single-use preview link. Changes no cached read. The caller opens `data.url` in a new tab. */
export function useCreatePreviewLink() {
  const api = useApi().admin
  return useApiMutation<PreviewLinkDto, CreatePreviewLinkInput>({
    idempotent: false,
    mutationFn: (input) => api.preview.createPreviewLink(input),
    invalidates: () => [],
  })
}
