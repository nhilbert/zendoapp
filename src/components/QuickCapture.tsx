import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/store/useStore'
import { useUi } from '@/store/useUi'
import { Button, Modal } from './ui'

export default function QuickCapture() {
  const { t } = useTranslation()
  const open = useUi((s) => s.captureOpen)
  const close = useUi((s) => s.closeCapture)
  const addInboxItem = useStore((s) => s.addInboxItem)
  const [text, setText] = useState('')
  const [captured, setCaptured] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // A capture closed without Enter (Escape, a stray click) is kept for the next opening.
    if (open) {
      setCaptured(false)
      window.setTimeout(() => ref.current?.focus(), 10)
    }
  }, [open])

  const submit = () => {
    if (!text.trim()) return
    addInboxItem(text)
    setText('')
    setCaptured(true)
    window.setTimeout(() => setCaptured(false), 1500)
  }

  return (
    <Modal open={open} onClose={close} width="max-w-xl" top="pt-4 md:pt-[18vh]">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        rows={2}
        placeholder={t('capture.placeholder')}
        className="w-full resize-none bg-transparent text-[18px] leading-relaxed placeholder:text-ink-3 focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-ink-3">
        <span className="hidden md:inline">{t('capture.hint')}</span>
        {captured ? <span className="fade-in text-accent">{t('capture.captured')}</span> : <span />}
        <Button variant="primary" size="sm" className="md:hidden" disabled={!text.trim()} onClick={submit}>
          {t('capture.button')}
        </Button>
      </div>
    </Modal>
  )
}
