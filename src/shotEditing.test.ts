import { describe, expect, it } from 'vitest'
import { updateShotInHole } from './shotEditing'
import type { Hole, Shot } from './domain'

describe('direct shot editing', () => {
  it('updates the next shot start without deleting later shots', () => {
    const first: Shot = {
      id: 'first',
      start: { lie: 'tee', distance: 400, unit: 'yards' },
      finish: { lie: 'fairway', distance: 150, unit: 'yards' },
      penaltyStrokes: 0,
    }
    const second: Shot = {
      id: 'second',
      start: first.finish,
      finish: { lie: 'green', distance: 10, unit: 'feet' },
      penaltyStrokes: 0,
    }
    const third: Shot = {
      id: 'third',
      start: second.finish,
      finish: { lie: 'holed', distance: 0, unit: 'feet' },
      penaltyStrokes: 0,
    }
    const hole: Hole = {
      number: 1,
      par: 4,
      yardage: 400,
      shots: [first, second, third],
    }
    const updatedFirst: Shot = {
      ...first,
      finish: { lie: 'rough', distance: 175, unit: 'yards' },
      penaltyStrokes: 1,
      club: 'Driver',
      note: 'Missed right',
    }

    const updated = updateShotInHole(hole, 0, updatedFirst)
    expect(updated.shots).toHaveLength(3)
    expect(updated.shots[0]).toEqual(updatedFirst)
    expect(updated.shots[1].start).toEqual(updatedFirst.finish)
    expect(updated.shots[2]).toEqual(third)
  })

  it('returns the original hole for an invalid index', () => {
    const hole: Hole = { number: 1, par: 4, yardage: 400, shots: [] }
    expect(updateShotInHole(hole, 1, {} as Shot)).toBe(hole)
  })
})
