'use client'

import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { MEDIA_CONTENT_TYPES, MAX_UPLOAD_BYTES } from '@/lib/api/types/admin/media'
import { qk } from '@/lib/query/keys'

export type UploadStatus = 'idle' | 'uploading' | 'completing' | 'done' | 'error'

export interface UploadState {
  status: UploadStatus
  progress: number | null
  error: string | null
}

const IDLE: UploadState = { status: 'idle', progress: null, error: null }

export function useUploadFlow() {
  const api = useApi().admin
  const queryClient = useQueryClient()
  const [state, setState] = useState<UploadState>(IDLE)
  const inFlight = useRef(false)

  const upload = useCallback(
    async (file: File): Promise<void> => {
      if (inFlight.current) return

      // Client-side validation
      if (!MEDIA_CONTENT_TYPES.includes(file.type as (typeof MEDIA_CONTENT_TYPES)[number])) {
        setState({ status: 'error', progress: null, error: 'Unsupported file type. Use JPEG, PNG, WebP, or AVIF.' })
        return
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setState({ status: 'error', progress: null, error: 'File exceeds the 10 MB limit.' })
        return
      }

      inFlight.current = true
      setState({ status: 'uploading', progress: 0, error: null })

      try {
        // Step 1 — request signed upload ticket
        const ticket = await api.media.requestUpload({
          filename: file.name,
          contentType: file.type as (typeof MEDIA_CONTENT_TYPES)[number],
          sizeBytes: file.size,
        })

        // Step 2 — PUT file directly to storage (with progress tracking via XHR).
        // In dev (STORAGE_MODE=fake) the backend returns http://localhost:8000/api/dev-storage/…
        // Sending that directly from the browser (localhost:3000) is cross-origin and CORS-blocked.
        // Convert backend-origin URLs to same-origin relative paths so the request goes through
        // the Next.js proxy (which forwards /api/* to Django without CORS issues).
        const normaliseUploadUrl = (raw: string): string => {
          if (raw.startsWith('/')) return raw // already relative
          try {
            const parsed = new URL(raw)
            // In dev, the Django backend returns http://localhost:8000/... while Next.js runs on :3000.
            // Sending cross-origin from the browser is CORS-blocked — strip to path so Next.js proxy handles it.
            // Only do this for localhost (not Supabase or other storage hosts in production).
            if (parsed.hostname === 'localhost' && parsed.origin !== window.location.origin) {
              return parsed.pathname + parsed.search + parsed.hash
            }
          } catch {
            // unparseable — fall through
          }
          return raw
        }
        const uploadUrl = normaliseUploadUrl(ticket.uploadUrl)

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('PUT', uploadUrl)
          Object.entries(ticket.headers).forEach(([k, v]) => xhr.setRequestHeader(k, v))
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              setState((s) => ({ ...s, progress: Math.round((e.loaded / e.total) * 90) }))
            }
          }
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage PUT failed: ${xhr.status}`)))
          xhr.onerror = () => reject(new Error('Storage PUT network error'))
          xhr.send(file)
        })

        setState((s) => ({ ...s, status: 'completing', progress: 95 }))

        // Step 3 — notify server upload complete
        await api.media.completeUpload(ticket.assetId)

        setState({ status: 'done', progress: 100, error: null })
        void queryClient.invalidateQueries({ queryKey: ['admin', 'media', 'assets'] })

        // Reset to idle after a short delay
        setTimeout(() => {
          setState(IDLE)
          inFlight.current = false
        }, 2000)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Upload failed.'
        setState({ status: 'error', progress: null, error: msg })
        inFlight.current = false
      }
    },
    [api, queryClient],
  )

  const reset = useCallback(() => {
    setState(IDLE)
    inFlight.current = false
  }, [])

  return { upload, reset, ...state }
}
