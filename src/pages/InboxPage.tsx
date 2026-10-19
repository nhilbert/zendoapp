import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight, X } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Button, Empty, IconButton, PageHeader } from '@/components/ui'
import { useLocale } from '@/components/TaskBits'

export default function InboxPage() {
  const { t } = useTranslation()
  const locale = useLocale()
  const navigate = useNavigate()
  const inbox = useStore((s) => s.inbox)
  const addInboxItem = useStore((s) => s.addInboxItem)
  const updateInboxItem = useStore((s) => s.updateInboxItem)
  const removeInboxItem = useStore((s) => s.removeInboxItem)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

  const items = [...inbox].reverse()
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={t('inbox.title')}
        subtitle={t('inbox.subtitle')}
        right={
          inbox.length > 0 && (
            <Button variant="primary" onClick={() => navigate('/clarify')}>
              {t('inbox.clarify', { count: inbox.length })} <ArrowRight size={14} />
            </Button>
          )
        }
      />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) {
            addInboxItem(text)
            setText('')
          }
        }}
      >
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('inbox.placeholder')}
          className="w-full border-b border-line bg-transparent py-3 text-[20px] placeholder:text-ink-3 focus:border-ink-3 focus:outline-none"
        />
      </form>

      {items.length === 0 ? (
        <Empty title={t('inbox.emptyTitle')} body={t('inbox.emptyBody')} />
      ) : (
        <ul className="mt-6 divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="group flex items-start gap-4 py-3.5">
              <div className="min-w-0 flex-1">
                {editing === item.id ? (
                  <textarea
                    autoFocus
                    defaultValue={item.text}
                    rows={Math.min(6, item.text.split('\n').length + 1)}
                    onBlur={(e) => {
                      updateInboxItem(item.id, e.target.value)
                      setEditing(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        ;(e.target as HTMLTextAreaElement).blur()
                      }
                    }}
                    className="field w-full resize-none py-2"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditing(item.id)}
                    title={t('inbox.editHint')}
                    className="w-full whitespace-pre-wrap text-left text-[15px] leading-relaxed"
                  >
                    {item.text}
                  </button>
                )}
                <div className="mt-0.5 text-[11px] text-ink-3">{fmt.format(new Date(item.createdAt))}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <IconButton label={t('nav.clarify')} onClick={() => navigate(`/clarify?id=${item.id}`)}>
                  <ArrowRight size={15} />
                </IconButton>
                <IconButton label={t('common.delete')} onClick={() => removeInboxItem(item.id)}>
                  <X size={15} />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
