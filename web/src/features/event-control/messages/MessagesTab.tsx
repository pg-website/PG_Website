'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/overlay/Dialog'
import { Field } from '@/components/ui/form/Field'
import { Textarea } from '@/components/ui/form/Textarea'
import { Input } from '@/components/ui/form/Input'
import { EmptyState } from '@/components/ui/feedback/EmptyState'
import { ErrorState } from '@/components/ui/feedback/ErrorState'
import { SkeletonRegion } from '@/components/ui/feedback/SkeletonRegion'
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge'
import { ResponsiveTable } from '@/components/ui/table/ResponsiveTable'
import { TableSkeleton } from '@/components/ui/table/TableSkeleton'
import type { TableColumn } from '@/components/ui/table/tableTypes'
import { useToast } from '@/components/ui/feedback/useToast'
import type { ControlTabProps } from '@/features/event-control/tabs'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import {
  MESSAGE_AUDIENCES,
  type MessageAudience,
  type MessageDeliveryStatus,
  type MessageLogEntry,
  sendMessageSchema,
  type SendMessageInput,
} from '@/lib/api/types/admin/control-messages'
import { formatEventDateTime } from '@/lib/format/date'
import { adminMessagesQuery, adminMessageQuery } from '@/lib/query/query-options/admin'
import { qk } from '@/lib/query/keys'
import { useApiMutation } from '@/lib/query/mutation'
import { newIdempotencyKey } from '@/lib/api/idempotency'

const DELIVERY_STATUS_LABEL: Record<MessageDeliveryStatus, string> = {
  queued: 'Queued',
  sending: 'Sending',
  delivered: 'Delivered',
  partial_failure: 'Partial failure',
  failed: 'Failed',
}

const DELIVERY_STATUS_TONE: Record<MessageDeliveryStatus, StatusTone> = {
  queued: 'neutral',
  sending: 'warning',
  delivered: 'success',
  partial_failure: 'warning',
  failed: 'danger',
}

const AUDIENCE_LABEL: Record<MessageAudience, string> = {
  confirmed: 'Confirmed',
  waitlist: 'Waitlist',
  checked_in: 'Checked-in',
  first_timers: 'First-timers',
}

const COLUMNS: TableColumn<MessageLogEntry>[] = [
  {
    id: 'at',
    header: 'At',
    cell: (row) => formatEventDateTime(row.createdAt),
    priority: 'primary',
  },
  {
    id: 'subject',
    header: 'Subject',
    cell: (row) => row.subject,
    priority: 'primary',
    rowHeader: true,
  },
  {
    id: 'audience',
    header: 'Audience',
    cell: (row) => AUDIENCE_LABEL[row.audience],
    priority: 'secondary',
  },
  {
    id: 'delivered',
    header: 'Delivered',
    cell: (row) => `${row.counts.delivered} / ${row.counts.recipients}`,
    align: 'end',
    priority: 'secondary',
  },
  {
    id: 'status',
    header: 'State',
    cell: (row) => (
      <StatusBadge tone={DELIVERY_STATUS_TONE[row.status]}>
        {DELIVERY_STATUS_LABEL[row.status]}
      </StatusBadge>
    ),
    priority: 'primary',
  },
]

/** Messages tab (screen 51, C14): message log with send capability and per-recipient delivery detail. */
export function MessagesTab({ eventId }: ControlTabProps) {
  const api = useApi()
  const toast = useToast()
  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null)

  const form = useForm<SendMessageInput>({
    resolver: zodResolver(sendMessageSchema),
    defaultValues: {
      audience: 'confirmed',
      channel: 'email',
      subject: '',
      body: '',
    },
  })

  const messagesQuery = useQuery({
    ...adminMessagesQuery(api.admin, eventId),
    placeholderData: keepPreviousData,
  })
  const data = messagesQuery.data

  // Load expanded message detail if one is selected
  const expandedMessageQuery = useQuery(
    expandedMessageId ? adminMessageQuery(api.admin, eventId, expandedMessageId) : { queryKey: [] as never, enabled: false },
  )

  const sendMutation = useApiMutation<
    Awaited<ReturnType<typeof api.admin.control.sendMessage>>,
    SendMessageInput
  >({
    mutationFn: async (input) => {
      const idempotencyKey = newIdempotencyKey()
      return api.admin.control.sendMessage(eventId, input, idempotencyKey)
    },
    invalidates: () => [qk.admin.messages(eventId)],
    onSuccess: () => {
      toast.success('Message sent')
      form.reset()
      setSendDialogOpen(false)
    },
    onError: (error) => {
      toast.error(`Failed to send message: ${error.message}`)
    },
  })

  const handleSendMessage = form.handleSubmit((input) => {
    sendMutation.mutate(input)
  })

  const rows: MessageLogEntry[] = data?.messages ?? []

  // Add row actions for expanding detail
  const actions = (row: MessageLogEntry) => (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        setExpandedMessageId((prev) => (prev === row.id ? null : row.id))
      }}
      className="text-sm font-medium text-forest hover:underline"
    >
      {expandedMessageId === row.id ? 'Hide' : 'Show'} details
    </button>
  )

  return (
    <div className="grid min-w-0 gap-4">
      {/* Send message button */}
      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={() => setSendDialogOpen(true)}
          disabled={data === undefined}
        >
          Send message
        </Button>
      </div>

      {/* Messages table */}
      {data === undefined && messagesQuery.isPending ? (
        <SkeletonRegion label="Loading messages">
          <TableSkeleton />
        </SkeletonRegion>
      ) : data === undefined ? (
        <ErrorState
          error={messagesQuery.error}
          action="load messages"
          onRetry={() => void messagesQuery.refetch()}
          retrying={messagesQuery.isFetching}
        />
      ) : (
        <div className="grid min-w-0 gap-4">
          <ResponsiveTable
            caption="Event messages"
            columns={COLUMNS}
            rows={rows}
            getRowId={(row) => row.id}
            actions={actions}
            actionsLabel="Show details"
            empty={
              <EmptyState framed={false} title="No messages yet">
                Messages sent through the Control Room appear here with delivery status.
              </EmptyState>
            }
          />

          {/* Expanded message detail */}
          {expandedMessageId && expandedMessageQuery.data && (
            <div className="rounded-public border border-line bg-surface-soft p-4">
              <h3 className="mb-4 font-semibold">Recipient delivery state</h3>
              {expandedMessageQuery.data.recipients.length === 0 ? (
                <p className="text-sm text-ink-soft">No recipients.</p>
              ) : (
                <div className="grid max-h-96 gap-2 overflow-y-auto">
                  {expandedMessageQuery.data.recipients.map((recipient) => (
                    <div
                      key={recipient.registrationId}
                      className="flex items-center justify-between border-b border-line py-2 text-sm last:border-b-0"
                    >
                      <span>{recipient.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-ink-soft">
                          {recipient.state === 'failed' ? recipient.reason : recipient.state}
                        </span>
                        <StatusBadge
                          tone={
                            recipient.state === 'delivered'
                              ? 'success'
                              : recipient.state === 'failed'
                                ? 'danger'
                                : 'neutral'
                          }
                        >
                          {recipient.state}
                        </StatusBadge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Send message dialog */}
      <Dialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        title="Send message"
        descriptionText="Send a message to event participants"
        size="lg"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => setSendDialogOpen(false)}
              disabled={sendMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSendMessage}
              loading={sendMutation.isPending}
            >
              Send
            </Button>
          </div>
        }
      >
        <form className="grid gap-4" onSubmit={(e) => e.preventDefault()}>
          <Field label="Audience">
            <select
              {...form.register('audience')}
              className="rounded-public border border-line bg-surface px-3 py-2"
            >
              {MESSAGE_AUDIENCES.map((aud) => (
                <option key={aud} value={aud}>
                  {AUDIENCE_LABEL[aud]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Channel">
            <select {...form.register('channel')} className="rounded-public border border-line bg-surface px-3 py-2">
              <option value="email">Email</option>
            </select>
          </Field>

          <Field label="Subject">
            <Input
              {...form.register('subject')}
              maxLength={150}
              placeholder="Email subject"
            />
          </Field>

          <Field label="Message body">
            <Textarea
              {...form.register('body')}
              maxLength={5000}
              placeholder="Message text"
              rows={6}
            />
          </Field>
        </form>
      </Dialog>
    </div>
  )
}
