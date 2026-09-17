import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearLastOwnerId,
  hasScopedLocalState,
  loadLastOwnerId,
  loadRounds,
  loadSharedCourses,
  loadSharedCourseMetadata,
  saveRounds,
  saveLastOwnerId,
  saveSharedCourses,
  saveSharedCourseMetadata,
} from './storage'
import type { Round } from './domain'

const values = new Map<string, string>()

beforeEach(() => {
  values.clear()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    },
  })
})

describe('account-scoped local storage', () => {
  it('keeps each authenticated user separate from legacy and other users', () => {
    const legacy = [{ id: 'legacy' }] as Round[]
    const userOne = [{ id: 'one' }] as Round[]
    const userTwo = [{ id: 'two' }] as Round[]

    saveRounds(legacy)
    saveRounds(userOne, 'owner-one')
    saveRounds(userTwo, 'owner-two')

    expect(loadRounds()).toEqual(legacy)
    expect(loadRounds('owner-one')).toEqual(userOne)
    expect(loadRounds('owner-two')).toEqual(userTwo)
    expect(hasScopedLocalState('owner-one')).toBe(true)
    expect(hasScopedLocalState('unknown')).toBe(false)
  })

  it('keeps shared catalog revisions scoped to the authenticated user', () => {
    saveSharedCourseMetadata('owner-one', {
      revision: 4,
      fingerprint: 'catalog-one',
    })

    expect(loadSharedCourseMetadata('owner-one')).toEqual({
      revision: 4,
      fingerprint: 'catalog-one',
    })
    expect(loadSharedCourseMetadata('owner-two')).toBeNull()
  })

  it('keeps the offline shared catalog scoped to the authenticated user', () => {
    const courses = [
      {
        key: 'alpha::blue',
        name: 'Alpha',
        teeName: 'Blue',
        holes: {},
      },
    ]
    saveSharedCourses('owner-one', courses)

    expect(loadSharedCourses('owner-one')).toEqual(courses)
    expect(loadSharedCourses('owner-two')).toEqual([])
  })

  it('tracks and clears only the last authorized offline owner', () => {
    saveLastOwnerId('owner-one')
    expect(loadLastOwnerId()).toBe('owner-one')
    clearLastOwnerId()
    expect(loadLastOwnerId()).toBeNull()
  })
})
