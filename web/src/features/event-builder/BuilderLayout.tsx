'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EVENT_STATUS_LABEL, EVENT_STATUS_TONE } from '@/components/domain/eventStatusLabels'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Heading } from '@/components/ui/Heading'
import { Eyebrow } from '@/components/ui/Eyebrow'
import { BuilderSaveBar } from '@/features/event-builder/BuilderSaveBar'
import { ReadOnlyEvent } from '@/features/event-builder/ReadOnlyEvent'
import { useBuilderSelector, useBuilderStore } from '@/features/event-builder/context'
import { MobileStepHeader } from '@/features/event-builder/MobileStepHeader'
import { BuilderNavProvider } from '@/features/event-builder/nav-context'
import { StepFooter } from '@/features/event-builder/StepFooter'
import { StepList } from '@/features/event-builder/StepList'
import { StepStrip } from '@/features/event-builder/StepStrip'
import { BUILDER_STEP_DEFINITIONS } from '@/features/event-builder/steps'
import { hasPending, parseBlockerField } from '@/features/event-builder/patch'
import { parseValidSteps, validStepKey } from '@/features/event-builder/validity'
import type { EventType } from '@/lib/api/types/event-state'
import type { BuilderDraftDto, BuilderStep } from '@/lib/api/types/admin/event-builder'
import { useDocumentTitle } from '@/lib/hooks/useDocumentTitle'
import { useLiveAnnouncer } from '@/lib/hooks/useLiveAnnouncer'

const PreviewSheet = dynamic(
  () => import('@/features/event-builder/PreviewSheet').then((module) => module.PreviewSheet),
  { loading: () => null },
)

export function BuilderLayout() {
  const store = useBuilderStore()
  const announce = useLiveAnnouncer()
  const eventType = useBuilderSelector(
    (state): EventType => (state.pending.basics?.type as EventType | undefined) ?? state.server.basics.type,
  )
  const title = useBuilderSelector(
    (state) => (state.pending.basics?.title as string | undefined) ?? state.server.basics.title,
  )
  const eventId = useBuilderSelector((state) => state.server.id)
  const status = useBuilderSelector((state) => state.server.status)
  const dirty = useBuilderSelector((state) => hasPending(state.pending))
  const validKey = useBuilderSelector(validStepKey)
  const blockerCounts = useBuilderSelector(blockerCountKey)

  const steps = useMemo(() => BUILDER_STEP_DEFINITIONS.filter((step) => step.relevantFor(eventType)), [eventType])
  const [currentId, setCurrentId] = useState<BuilderStep>('basics')
  const [visited, setVisited] = useState<ReadonlySet<BuilderStep>>(() => new Set<BuilderStep>(['basics']))
  const [stepsOpen, setStepsOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)

  const current = steps.find((step) => step.id === currentId) ?? steps[0]
  const index = current === undefined ? 0 : steps.indexOf(current)
  const valid = useMemo(() => parseValidSteps(validKey), [validKey])

  // Forward jumps only to visited steps or steps whose predecessors are all valid (TASK-077).
  const reachable = useMemo(() => {
    const out = new Set<BuilderStep>()
    let predecessorsValid = true
    for (const step of steps) {
      if (predecessorsValid || visited.has(step.id)) out.add(step.id)
      if (!valid.has(step.id)) predecessorsValid = false
    }
    return out
  }, [steps, valid, visited])

  const counts = useMemo(() => JSON.parse(blockerCounts) as Record<string, number>, [blockerCounts])

  useDocumentTitle(`${title.trim() === '' ? 'New event' : title.trim()} | Event builder`)

  const goToStep = useCallback(
    (step: BuilderStep) => {
      void store.flush() // leaving a step sends its edits now instead of waiting for the debounce
      moved.current = true
      setCurrentId(step)
      setVisited((previous) => (previous.has(step) ? previous : new Set(previous).add(step)))
    },
    [store],
  )

  // Focus the step heading on step change and announce "Step n of N" (AC-9). Not on first render.
  useEffect(() => {
    if (!moved.current || current === undefined) return
    headingRef.current?.focus({ preventScroll: false })
    announce(`Step ${index + 1} of ${steps.length}: ${current.label}`)
  }, [current, index, steps.length, announce])

  // Preload the next step chunk once this step is valid (bundle-preload).
  useEffect(() => {
    const next = steps[index + 1]
    if (current !== undefined && valid.has(current.id) && next !== undefined) void next.preload()
  }, [current, index, steps, valid])

  // In-app navigation guard: warn before leaving with unsent edits (beforeunload is covered by SaveBar).
  useEffect(() => {
    if (!dirty) return
    const onClick = (event: MouseEvent): void => {
      const anchor = (event.target as Element | null)?.closest('a[href]')
      if (anchor === null || anchor === undefined || anchor.getAttribute('target') === '_blank') return
      const href = anchor.getAttribute('href') ?? ''
      if (!href.startsWith('/') || href.startsWith(`/admin/events/${eventId}/edit`)) return
      if (!window.confirm('You have changes that are not saved yet. Leave this page anyway?')) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty, eventId])

  // Browser back with unsent edits: send them (best effort) and ask before leaving. The unmount flush and the session
  // backup cover the rest.
  useEffect(() => {
    if (!dirty) return
    const onPop = (): void => {
      void store.flush()
      if (!window.confirm('You have changes that are not saved yet. Leave this page anyway?')) window.history.go(1)
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
    }
  }, [dirty, store])

  if (current === undefined) return null
  if (status === 'completed' || status === 'cancelled') {
    return <ReadOnlyEvent title={title} status={status} />
  }
  const Body = current.component
  const isLast = index === steps.length - 1

  const onContinue = async (): Promise<void> => {
    setChecking(true)
    try {
      const ok = current.dataKey === null ? true : await store.validateStep(current.dataKey)
      if (!ok) {
        announce('This step has problems. Fix the highlighted fields.')
        return
      }
      await store.flush()
      const rejected = Object.keys(store.getState().fieldErrors).some(
        (path) => current.dataKey !== null && path.startsWith(`${current.dataKey}.`),
      )
      if (rejected) {
        announce('The server did not accept a field on this step. Fix it to continue.')
        return
      }
      const next = steps[index + 1]
      if (next !== undefined) goToStep(next.id)
    } finally {
      setChecking(false)
    }
  }

  const stepperProps = { steps, current: current.id, reachable, blockerCounts: counts, onSelect: goToStep }

  return (
    <BuilderNavProvider goToStep={goToStep}>
      <div className="flex min-w-0 flex-col gap-4 pt-6">
        {/* work-head: static tagline + status badge (reference screen 38) */}
        <header className="flex min-w-0 flex-wrap items-end justify-between gap-6 pb-2">
          <div className="min-w-0">
            <Eyebrow>Event Builder</Eyebrow>
            <Heading level={1} size="page-intro" className="mt-1">
              Build the experience before the operations.
            </Heading>
            <p className="mt-2 max-w-prose text-sm text-muted">
              Every event type uses one core model; only relevant mechanics are exposed.
            </p>
          </div>
          <StatusBadge tone={EVENT_STATUS_TONE[status]}>{EVENT_STATUS_LABEL[status]}</StatusBadge>
        </header>

        <MobileStepHeader {...stepperProps} open={stepsOpen} onOpenChange={setStepsOpen} />
        <StepStrip {...stepperProps} />

        {/* builder-static: 2-column (step-list + panel), no right preview column */}
        <div className="grid min-w-0 gap-4 lg:grid-cols-[210px_1fr]">
          <StepList {...stepperProps} />
          <section aria-labelledby="builder-step-title" className="min-w-0">
            <div className="border border-line-admin bg-admin-panel p-7">
              {/* Step panel header: eyebrow + h2 (reference builder-panel) */}
              <div className="mb-5">
                <Eyebrow>
                  Step {index + 1} / {steps.length}
                </Eyebrow>
                <h2
                  id="builder-step-title"
                  ref={headingRef}
                  tabIndex={-1}
                  className="mt-1 font-display text-3xl leading-none font-medium tracking-tight wrap-break-word outline-none"
                >
                  {current.label}
                </h2>
              </div>
              <Body stepId={current.id} dataKey={current.dataKey} />
              {/* builder-footer-static: inline back/continue row inside the panel */}
              <StepFooter
                canBack={index > 0}
                isLast={isLast}
                busy={checking}
                onPreview={() => {
                  setPreviewOpen(true)
                }}
                onBack={() => {
                  const previous = steps[index - 1]
                  if (previous !== undefined) goToStep(previous.id)
                }}
                onContinue={() => void onContinue()}
              />
            </div>
          </section>
        </div>
      </div>

      <div className="sticky bottom-0 z-header mt-6">
        <BuilderSaveBar />
      </div>
      {previewOpen ? <PreviewSheet open onOpenChange={setPreviewOpen} /> : null}
    </BuilderNavProvider>
  )
}

function blockerCountKey(state: { server: BuilderDraftDto }): string {
  const readiness = state.server.readiness
  if (readiness.ready) return '{}'
  const counts: Record<string, number> = {}
  for (const blocker of readiness.blockers) {
    const step = parseBlockerField(blocker.field).step
    if (step !== null) counts[step] = (counts[step] ?? 0) + 1
  }
  return JSON.stringify(counts)
}
