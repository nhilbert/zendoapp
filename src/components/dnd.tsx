import type { ReactNode } from 'react'
import {
  type CollisionDetection,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { cx } from './ui'

export function useDndSensors() {
  return useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor))
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
      className={cx('touch-none', isDragging && 'opacity-40', !disabled && 'cursor-grab active:cursor-grabbing', className)}
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
