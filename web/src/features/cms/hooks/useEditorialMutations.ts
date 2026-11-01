'use client'

import { useApi } from '@/lib/api/adapters/useApi.browser'
import type { PublicationResult } from '@/lib/api/types/admin/common'
import type {
  AdminStoryDto,
  CreateStoryInput,
  StoryPublishResult,
  UpdateStoryInput,
} from '@/lib/api/types/admin/stories'
import type {
  AdminTestimonialDto,
  CreateTestimonialInput,
  UpdateTestimonialInput,
} from '@/lib/api/types/admin/testimonials'
import { qk } from '@/lib/query/keys'
import { useApiMutation } from '@/lib/query/mutation'

// CMS-F1: story (S13, S14) and testimonial (S15, S16) writes. PATCH saves the record, publish/unpublish flips its status.
// A stale `version` fails with VERSION_CONFLICT (check with `isVersionConflict`, then re-read). SLUG_TAKEN, SLUG_LOCKED,
// NOT_PUBLISHABLE, CONSENT_REQUIRED and ASSET_ARCHIVED arrive as ApiError codes / `fields`: render with `copyFor`.

type StoryId = AdminStoryDto['id']
type TestimonialId = AdminTestimonialDto['id']

export function useCreateStory() {
  const api = useApi().admin
  return useApiMutation<AdminStoryDto, CreateStoryInput>({
    idempotent: false,
    mutationFn: (input) => api.stories.createStory(input),
    invalidates: () => [qk.admin.storiesAll()],
  })
}

export function useUpdateStory(id: StoryId) {
  const api = useApi().admin
  return useApiMutation<AdminStoryDto, UpdateStoryInput>({
    idempotent: false,
    mutationFn: (input) => api.stories.updateStory(id, input),
    invalidates: () => [qk.admin.story(id), qk.admin.storiesAll()],
  })
}

/** S14 publish. Idempotency-Key per intent. Locks the slug. */
export function usePublishStory(id: StoryId) {
  const api = useApi().admin
  return useApiMutation<StoryPublishResult, void>({
    mutationFn: (_vars, { idempotencyKey }) => {
      if (idempotencyKey === null) throw new Error('Publish needs an idempotency key')
      return api.stories.publishStory(id, idempotencyKey)
    },
    invalidates: () => [qk.admin.story(id), qk.admin.storiesAll()],
  })
}

export function useUnpublishStory(id: StoryId) {
  const api = useApi().admin
  return useApiMutation<StoryPublishResult, void>({
    idempotent: false,
    mutationFn: () => api.stories.unpublishStory(id),
    invalidates: () => [qk.admin.story(id), qk.admin.storiesAll()],
  })
}

export function useCreateTestimonial() {
  const api = useApi().admin
  return useApiMutation<AdminTestimonialDto, CreateTestimonialInput>({
    idempotent: false,
    mutationFn: (input) => api.testimonials.createTestimonial(input),
    invalidates: () => [qk.admin.testimonialsAll()],
  })
}

/** PATCH also carries `sortOrder`, which is how a testimonial is reordered. */
export function useUpdateTestimonial(id: TestimonialId) {
  const api = useApi().admin
  return useApiMutation<AdminTestimonialDto, UpdateTestimonialInput>({
    idempotent: false,
    mutationFn: (input) => api.testimonials.updateTestimonial(id, input),
    invalidates: () => [qk.admin.testimonial(id), qk.admin.testimonialsAll()],
  })
}

export function usePublishTestimonial(id: TestimonialId) {
  const api = useApi().admin
  return useApiMutation<PublicationResult, void>({
    idempotent: false,
    mutationFn: () => api.testimonials.publishTestimonial(id),
    invalidates: () => [qk.admin.testimonial(id), qk.admin.testimonialsAll()],
  })
}

export function useUnpublishTestimonial(id: TestimonialId) {
  const api = useApi().admin
  return useApiMutation<PublicationResult, void>({
    idempotent: false,
    mutationFn: () => api.testimonials.unpublishTestimonial(id),
    invalidates: () => [qk.admin.testimonial(id), qk.admin.testimonialsAll()],
  })
}
