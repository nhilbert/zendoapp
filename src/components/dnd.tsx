import { type CSSProperties, type PointerEvent, type ReactNode, useRef, useState } from 'react'
import {
  type CollisionDetection,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { cx } from './ui'

/** Mouse: drag after 6 px. Touch: press and hold 250 ms, so a normal swipe still scrolls. */
export function useDndSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )
}

/** Pointer-precise where possible, rectangle overlap as fallback. */
export const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args)
  return within.length ? within : rectIntersection(args)
}

export function Draggable({
  id,
  data,
  children,
  className,
  disabled,
  onClick,
}: {
  id: string
  data?: Record<string, unknown>
  children: ReactNode
  className?: string
  disabled?: boolean
  onClick?: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data, disabled })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={cx('touch-manipulation select-none [-webkit-touch-callout:none]', isDragging && 'opacity-40', !disabled && 'cursor-grab active:cursor-grabbing', className)}
    >
      {children}
    </div>
  )
}

export function Droppable({
  id,
  children,
  className,
  overClassName,
  data,
}: {
  id: string
  children?: ReactNode
  className?: string
  overClassName?: string
  data?: Record<string, unknown>
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data })
  return (
    <div ref={setNodeRef} className={cx(className, isOver && overClassName)}>
      {children}
    </div>
  )
}

/**
 * Touch swipe on a row: right calls onRight, left calls onLeft. The row slides with the finger over a tinted
 * background; released past the threshold it slides out, otherwise it snaps back. Only a quick horizontal move
 * counts, so vertical scrolling and the 250 ms long-press drag keep working. Mouse and pen are left to drag and drop.
 * The caller positions it (`relative` or `absolute`).
 */
export function Swipeable({
  children,
  className,
  style,
  onLeft,
  onRight,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  onLeft?: () => void
  onRight?: () => void
}) {
  const start = useRef<{ x: number; y: number; t: number; id: number } | null>(null)
  const mode = useRef<'idle' | 'swipe' | 'off'>('idle')
  const swiped = useRef(false)
  const [dx, setDx] = useState(0)
  const [settling, setSettling] = useState(false)

  const down = (e: PointerEvent<HTMLDivElement>) => {
    swiped.current = false
    if (e.pointerType !== 'touch') return
    start.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId }
    mode.current = 'idle'
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current
    if (!s || s.id !== e.pointerId || mode.current === 'off') return
    let d = e.clientX - s.x
    if (mode.current === 'idle') {
      const ax = Math.abs(d)
      const ay = Math.abs(e.clientY - s.y)
      if (ay > 10 || e.timeStamp - s.t > 250) mode.current = 'off'
      else if (ax > 10 && ax > ay * 1.5) {
        mode.current = 'swipe'
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      if (mode.current !== 'swipe') return
    }
    if ((d > 0 && !onRight) || (d < 0 && !onLeft)) d = 0
    setSettling(false)
    setDx(d)
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current
    if (!s || s.id !== e.pointerId) return
    start.current = null
    if (mode.current !== 'swipe') return
    swiped.current = true
    const w = e.currentTarget.offsetWidth
    const act = e.type === 'pointerup' && Math.abs(dx) > Math.min(96, w * 0.35)
    setSettling(true)
    if (!act) return setDx(0)
    setDx(dx > 0 ? w : -w)
    window.setTimeout(() => {
      ;(dx > 0 ? onRight : onLeft)?.()
      setSettling(false)
      setDx(0)
    }, 160)
  }

  return (
    <div
      className={cx('overflow-hidden touch-pan-y', className)}
      style={style}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClickCapture={(e) => {
        // the tap that ends a swipe must not open the task
        if (swiped.current) {
          swiped.current = false
          e.stopPropagation()
          e.preventDefault()
        }
      }}
    >
      {dx !== 0 && <div aria-hidden className={cx('absolute inset-0 rounded-[inherit]', dx > 0 ? 'bg-accent-soft' : 'bg-surface-3')} />}
      <div className={cx('relative h-full', dx !== 0 && 'bg-paper', settling && 'transition-transform duration-150 ease-out')} style={dx ? { transform: `translateX(${dx}px)` } : undefined}>
        {children}
      </div>
    </div>
  )
}
