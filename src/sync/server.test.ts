import { describe, expect, it } from 'vitest'
import { diffCollections, type Collections } from './server'

const base = (): Collections => ({ inbox: [], projects: [], tasks: [], events: [], blocks: [], reviews: [] })

describe('diffCollections', () => {
  it('reports changed references, new ids and removed ids only', () => {
    const a = { id: 'a', title: 'a' }
    const b = { id: 'b', title: 'b' }
    const prev = { ...base(), tasks: [a, b] as never }
    const next = { ...base(), tasks: [a, { ...b, title: 'b2' }, { id: 'c', title: 'c' }] as never }
    const ch = diffCollections(prev, next)!
    expect(ch.upserts.tasks?.map((t) => t.id)).toEqual(['b', 'c'])
    expect(ch.deletes.tasks).toBeUndefined()
    const removed = diffCollections(next, { ...base(), tasks: [a] as never })!
    expect(removed.deletes.tasks?.sort()).toEqual(['b', 'c'])
    expect(removed.upserts.tasks).toBeUndefined()
  })
  it('returns null when nothing changed', () => {
    const prev = base()
    expect(diffCollections(prev, { ...prev })).toBeNull()
  })
})
