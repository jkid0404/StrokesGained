import { describe, expect, it } from 'vitest'
import type { CourseTemplate } from './domain'
import { mergeSharedCourses } from './sharedCourses'

describe('shared course catalog', () => {
  it('keeps personal courses and prefers shared definitions for matching keys', () => {
    const personal: CourseTemplate[] = [
      {
        key: 'alpha::blue',
        name: 'Alpha',
        teeName: 'Blue',
        holes: { 1: { par: 4, yardage: 390 } },
      },
      {
        key: 'personal::white',
        name: 'Personal',
        teeName: 'White',
        holes: {},
      },
    ]
    const shared: CourseTemplate[] = [
      {
        key: 'alpha::blue',
        name: 'Alpha',
        teeName: 'Blue',
        holes: { 1: { par: 4, yardage: 400 } },
      },
    ]

    const merged = mergeSharedCourses(personal, shared)
    expect(merged).toHaveLength(2)
    expect(merged.find((course) => course.key === 'alpha::blue')?.holes[1])
      .toEqual({ par: 4, yardage: 400 })
  })
})
