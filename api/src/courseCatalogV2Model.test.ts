import { describe, expect, it } from 'vitest'
import {
  CourseConflictError,
  addCourseAggregateTee,
  archiveCourseAggregateTee,
  convertLegacyCatalog,
  createCourseAggregate,
  deterministicCatalogId,
  flattenCourseAggregate,
  updateCourseAggregateTee,
} from './courseCatalogV2Model.js'
import type { StoredCourseCatalog } from './courseCatalogModel.js'

describe('V2 course catalog model', () => {
  it('converts legacy templates into stable aggregate identities', () => {
    const legacy: StoredCourseCatalog = {
      id: 'catalog',
      revision: 7,
      updatedAt: '2026-09-17T00:00:00Z',
      courses: [
        {
          key: 'alpha::blue',
          name: 'Alpha',
          teeName: 'Blue',
          aliases: ['old alpha::blue'],
          holes: { 1: { par: 4, yardage: 400 } },
        },
        {
          key: 'alpha::white',
          name: 'Alpha',
          teeName: 'White',
          holes: {},
        },
      ],
    }

    const first = convertLegacyCatalog(legacy)
    const second = convertLegacyCatalog(legacy)
    expect(first).toEqual(second)
    expect(first).toHaveLength(1)
    expect(first[0].courseId).toBe(
      deterministicCatalogId('course', 'alpha'),
    )
    expect(first[0].tees).toHaveLength(2)
    expect(flattenCourseAggregate(first[0])[0]).toMatchObject({
      courseId: first[0].courseId,
      revision: 1,
    })
  })

  it('keeps immutable IDs and adds the old key as an alias on rename', () => {
    const original = createCourseAggregate(
      {
        name: 'Alpha',
        teeName: 'Blue',
        holes: { 1: { par: 4, yardage: 400 } },
      },
      '2026-09-17T00:00:00Z',
      {
        courseId: 'course-11111111-1111-5111-8111-111111111111',
        teeId: 'tee-22222222-2222-5222-8222-222222222222',
      },
    )
    const updated = updateCourseAggregateTee(
      original,
      original.tees[0].teeId,
      {
        name: 'Alpha Golf Club',
        teeName: 'Gold',
        holes: original.tees[0].holes,
        revision: 1,
      },
      '2026-09-18T00:00:00Z',
    )

    expect(updated.courseId).toBe(original.courseId)
    expect(updated.tees[0].teeId).toBe(original.tees[0].teeId)
    expect(updated.tees[0].aliases).toEqual(['alpha::blue'])
    expect(updated.revision).toBe(2)
  })

  it('rejects stale updates and archives the final active tee/course', () => {
    const original = createCourseAggregate(
      { name: 'Alpha', teeName: 'Blue', holes: {} },
      undefined,
      {
        courseId: 'course-11111111-1111-5111-8111-111111111111',
        teeId: 'tee-22222222-2222-5222-8222-222222222222',
      },
    )
    expect(() =>
      updateCourseAggregateTee(original, original.tees[0].teeId, {
        name: 'Alpha',
        teeName: 'Blue',
        holes: {},
        revision: 2,
      }),
    ).toThrow(CourseConflictError)

    const archived = archiveCourseAggregateTee(
      original,
      original.tees[0].teeId,
      1,
    )
    expect(archived.status).toBe('archived')
    expect(archived.tees[0].status).toBe('archived')
    expect(flattenCourseAggregate(archived)).toEqual([])
  })

  it('adds a tee without changing the immutable course identity', () => {
    const original = createCourseAggregate(
      { name: 'Alpha', teeName: 'Blue', holes: {} },
      undefined,
      {
        courseId: 'course-11111111-1111-5111-8111-111111111111',
        teeId: 'tee-22222222-2222-5222-8222-222222222222',
      },
    )
    const updated = addCourseAggregateTee(
      original,
      {
        name: 'Alpha',
        teeName: 'White',
        holes: {},
        revision: 1,
      },
      undefined,
      'tee-33333333-3333-5333-8333-333333333333',
    )

    expect(updated.courseId).toBe(original.courseId)
    expect(updated.tees.map((tee) => tee.name)).toEqual(['Blue', 'White'])
    expect(updated.revision).toBe(2)
  })

  it('removes the current normalized key from migrated aliases', () => {
    const [migrated] = convertLegacyCatalog({
      id: 'catalog',
      revision: 1,
      updatedAt: '2026-09-17T00:00:00Z',
      courses: [
        {
          key: 'alpha::blue',
          name: 'Alpha',
          teeName: 'Blue',
          aliases: ['alpha::blue', 'old alpha::blue'],
          holes: {},
        },
      ],
    })

    expect(migrated.tees[0].aliases).toEqual(['old alpha::blue'])
  })
})
