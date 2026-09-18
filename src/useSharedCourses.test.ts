import { describe, expect, it } from 'vitest'
import { canPersistSharedCourseCache } from './useSharedCourses'

describe('shared course cache initialization', () => {
  it('does not persist the initial empty state before the owner is initialized', () => {
    expect(canPersistSharedCourseCache('owner-1', null)).toBe(false)
    expect(canPersistSharedCourseCache('owner-1', 'owner-2')).toBe(false)
  })

  it('persists shared courses after the current owner is initialized', () => {
    expect(canPersistSharedCourseCache('owner-1', 'owner-1')).toBe(true)
  })
})
