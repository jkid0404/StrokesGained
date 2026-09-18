import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CourseTemplate } from './domain'
import {
  createSharedCourse,
  deleteSharedCourse,
  mergeSharedCourses,
  updateSharedCourse,
} from './sharedCourses'

afterEach(() => {
  vi.unstubAllGlobals()
})

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

  it('uses aliases to avoid duplicate personal entries after a shared rename', () => {
    const personal: CourseTemplate[] = [
      {
        key: 'alpha::blue',
        name: 'Alpha',
        teeName: 'Blue',
        holes: {},
      },
    ]
    const shared: CourseTemplate[] = [
      {
        key: 'alpha golf club::gold',
        aliases: ['alpha::blue'],
        name: 'Alpha Golf Club',
        teeName: 'Gold',
        holes: {},
        courseId: 'course-1',
        teeId: 'tee-1',
        revision: 2,
      },
    ]

    expect(mergeSharedCourses(personal, shared)).toEqual(shared)
  })

  it('uses only item-level POST, PATCH, and DELETE mutations', async () => {
    const paths: string[] = []
    const requests: RequestInit[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init: RequestInit) => {
        paths.push(path)
        requests.push(init)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              courses: [],
              revision: 1,
              updatedAt: '2026-09-18T00:00:00Z',
              exists: true,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }),
    )
    const personal: CourseTemplate = {
      key: 'alpha::blue',
      name: 'Alpha',
      teeName: 'Blue',
      holes: {},
    }
    const shared: CourseTemplate = {
      ...personal,
      courseId: 'course-1',
      teeId: 'tee-1',
      revision: 1,
    }

    await createSharedCourse(personal)
    await createSharedCourse(
      { ...personal, key: 'alpha::white', teeName: 'White' },
      shared,
    )
    await updateSharedCourse(shared)
    await deleteSharedCourse(shared)

    expect(requests.map((request) => request.method)).toEqual([
      'POST',
      'POST',
      'PATCH',
      'DELETE',
    ])
    expect(paths[1]).toBe('/api/courses/course-1/tees')
    expect(JSON.parse(requests[1].body as string)).toMatchObject({
      name: 'Alpha',
      teeName: 'White',
      revision: 1,
    })
    expect(requests.some((request) => request.method === 'PUT')).toBe(false)
  })
})
