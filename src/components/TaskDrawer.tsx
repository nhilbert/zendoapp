import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, X } from 'lucide-react'
import type { Priority, Recurrence, TaskStatus } from '@/domain/types'
import { RECURRENCES, TASK_STATUSES } from '@/domain/types'
import { useStore } from '@/store/useStore'
import { useUi } from '@/store/useUi'
import { fmtDate, fmtTime } from '@/domain/dates'
import { Button, Checkbox, Drawer, Field, IconButton, Input, Segmented, Select, Textarea, cx } from './ui'
import { fmtEstimate, useLocale } from './TaskBits'

const ESTIMATES = [15, 30, 60, 120, 240, 480] as const

export default function TaskDrawer() {
  const { t } = useTranslation()
  const locale = useLocale()
  const taskId = useUi((s) => s.taskId)
  const close = useUi((s) => s.closeTask)
  const task = useStore((s) => s.tasks.find((x) => x.id === taskId))
  const projects = useStore((s) => s.projects)
  const updateTask = useStore((s) => s.updateTask)
  const setTaskStatus = useStore((s) => s.setTaskStatus)
  const completeTask = useStore((s) => s.completeTask)
  const deleteTask = useStore((s) => s.deleteTask)
  const addTaskNote = useStore((s) => s.addTaskNote)
  const [note, setNote] = useState('')

  if (!task) return null

  const statusLabel = (s: TaskStatus) => t(`status.${s}`)

  return (
    <Drawer open onClose={close}>
      <div className="mb-5 flex items-start gap-3">
        <Checkbox checked={task.status === 'done'} onChange={(v) => completeTask(task.id, v)} className="mt-[7px]" />
        <textarea
          value={task.title}
          onChange={(e) => updateTask(task.id, { title: e.target.value })}
          rows={2}
          className={cx('field-bare -ml-2 w-full resize-none px-2 py-1 text-[17px] font-medium leading-snug', task.status === 'done' && 'strike')}
        />
        <IconButton label={t('common.close')} onClick={close}>
          <X size={16} />
        </IconButton>
      </div>

      <div className="flex flex-col gap-4">
        <Field label={t('task.status')}>
          <Select value={task.status} onChange={(e) => setTaskStatus(task.id, e.target.value as TaskStatus)}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </Field>
        {task.status === 'waiting' && (
          <Field label={t('task.waitingFor')}>
            <Input value={task.waitingFor ?? ''} placeholder={t('task.waitingPlaceholder')} onChange={(e) => updateTask(task.id, { waitingFor: e.target.value })} />
          </Field>
        )}
        <Field label={t('task.project')}>
          <Select value={task.projectId ?? ''} onChange={(e) => updateTask(task.id, { projectId: e.target.value || null })}>
            <option value="">{t('task.chore')}</option>
            {projects
              .filter((p) => p.status === 'active' || p.status === 'planned' || p.id === task.projectId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <Checkbox checked={!!task.private} onChange={(v) => updateTask(task.id, { private: v })} /> {t('privacy.task')}
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('task.priority')}>
            <div>
              <Segmented<Priority>
                value={task.priority}
                onChange={(v) => updateTask(task.id, { priority: v })}
                options={[
                  { value: 'high', label: t('priority.high') },
                  { value: 'normal', label: t('priority.normal') },
                  { value: 'low', label: t('priority.low') },
                ]}
              />
            </div>
          </Field>
          <Field label={t('task.estimate')}>
            <Select value={task.estimateMinutes ?? ''} onChange={(e) => updateTask(task.id, { estimateMinutes: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">—</option>
              {task.estimateMinutes !== undefined && !(ESTIMATES as readonly number[]).includes(task.estimateMinutes) && (
                <option value={task.estimateMinutes}>{fmtEstimate(task.estimateMinutes, t)}</option>
              )}
              {ESTIMATES.map((m) => (
                <option key={m} value={m}>
                  {fmtEstimate(m, t)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('task.due')}>
            <Input type="date" value={task.dueDate ?? ''} onChange={(e) => updateTask(task.id, { dueDate: e.target.value || undefined })} />
          </Field>
          <Field label={t('task.planned')}>
            <Input
              type="date"
              value={task.plannedDate ?? ''}
              onChange={(e) => updateTask(task.id, { plannedDate: e.target.value || undefined, plannedStart: e.target.value ? task.plannedStart : undefined })}
            />
          </Field>
        </div>
        {task.plannedDate && (
          <Field label={t('task.plannedStart')}>
            <div className="flex items-center gap-2">
              <Input type="time" step={900} value={task.plannedStart ?? ''} onChange={(e) => updateTask(task.id, { plannedStart: e.target.value || undefined })} className="w-36" />
              {task.plannedStart && (
                <span className="text-[12px] text-ink-3">
                  {fmtDate(task.plannedDate, locale)} · {fmtTime(task.plannedStart, locale)}
                </span>
              )}
            </div>
          </Field>
        )}
        <Field label={t('task.recurrence')}>
          <Select value={task.recurrence ?? ''} onChange={(e) => updateTask(task.id, { recurrence: (e.target.value || undefined) as Recurrence | undefined })}>
            <option value="">{t('recurrence.none')}</option>
            {RECURRENCES.map((r) => (
              <option key={r} value={r}>
                {t(`recurrence.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('task.description')}>
          <Textarea value={task.description ?? ''} onChange={(e) => updateTask(task.id, { description: e.target.value })} />
        </Field>

        <div>
          <div className="mb-1 text-[12px] font-medium text-ink-2">{t('task.notes')}</div>
          {task.notes.length > 0 && (
            <ul className="mb-2 flex flex-col gap-2">
              {task.notes.map((n) => (
                <li key={n.id} className="rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
                  <div className="whitespace-pre-wrap">{n.text}</div>
                  <div className="mt-1 text-[11px] text-ink-3">{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(n.createdAt))}</div>
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (note.trim()) {
                addTaskNote(task.id, note)
                setNote('')
              }
            }}
          >
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('task.addNote')} />
          </form>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              if (window.confirm(t('task.deleteConfirm'))) {
                deleteTask(task.id)
                close()
              }
            }}
          >
            <Trash2 size={13} /> {t('task.delete')}
          </Button>
          {task.plannedDate && (
            <Button variant="ghost" size="sm" onClick={() => updateTask(task.id, { plannedDate: undefined, plannedStart: undefined })}>
              {t('task.unschedule')}
            </Button>
          )}
        </div>
      </div>
    </Drawer>
  )
}
