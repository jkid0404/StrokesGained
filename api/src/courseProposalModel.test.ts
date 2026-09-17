import { describe, expect, it } from 'vitest'
import {
  applyApprovedProposal,
  createCourseProposal,
  ProposalConflictError,
  validateCreateCourseProposal,
} from './courseProposalModel.js'
import type { StoredCourseCatalog } from './courseCatalogModel.js'

const course = {
  key: 'alpha::blue',
  name: 'Alpha',
  teeName: 'Blue',
  holes: { 1: { par: 4, yardage: 400 } },
}

describe('course proposal model', () => {
  it('creates an edit proposal from the current shared course', () => {
    const catalog = makeCatalog([course])
    const proposal = createCourseProposal(
      validateCreateCourseProposal({
        targetCourseKey: course.key,
        baseCatalogRevision: 3,
        baseCourse: course,
        proposedCourse: {
          ...course,
          holes: { 1: { par: 4, yardage: 410 } },
        },
        message: 'Corrected hole one.',
      }),
      { userId: 'owner', userDetails: 'golfer@example.com' },
      catalog,
    )

    expect(proposal.type).toBe('edit')
    expect(proposal.baseCourse).toEqual(course)
    expect(proposal.baseCatalogRevision).toBe(3)
  })

  it('applies a valid edit and preserves the old key as an alias', () => {
    const catalog = makeCatalog([course])
    const proposal = createCourseProposal(
      {
        targetCourseKey: course.key,
        baseCatalogRevision: 3,
        baseCourse: course,
        proposedCourse: {
          ...course,
          key: 'alpha::gold',
          teeName: 'Gold',
        },
        message: '',
      },
      { userId: 'owner', userDetails: 'golfer@example.com' },
      catalog,
    )

    expect(applyApprovedProposal(proposal, catalog)).toEqual([
      expect.objectContaining({
        key: 'alpha::gold',
        aliases: ['alpha::blue'],
      }),
    ])
  })

  it('rejects stale edits instead of overwriting newer catalog data', () => {
    const originalCatalog = makeCatalog([course])
    const proposal = createCourseProposal(
      {
        targetCourseKey: course.key,
        baseCatalogRevision: 3,
        baseCourse: course,
        proposedCourse: {
          ...course,
          holes: { 1: { par: 4, yardage: 410 } },
        },
        message: '',
      },
      { userId: 'owner', userDetails: 'golfer@example.com' },
      originalCatalog,
    )
    const changedCatalog = makeCatalog([
      { ...course, holes: { 1: { par: 5, yardage: 400 } } },
    ])

    expect(() => applyApprovedProposal(proposal, changedCatalog)).toThrow(
      ProposalConflictError,
    )
  })

  it('recognizes a renamed edit as already applied after aliases are added', () => {
    const catalog = makeCatalog([course])
    const proposal = createCourseProposal(
      {
        targetCourseKey: course.key,
        baseCatalogRevision: 3,
        baseCourse: course,
        proposedCourse: {
          ...course,
          key: 'alpha::gold',
          teeName: 'Gold',
        },
        message: '',
      },
      { userId: 'owner', userDetails: 'golfer@example.com' },
      catalog,
    )
    const appliedCatalog = makeCatalog([
      {
        ...(proposal.proposedCourse as object),
        aliases: ['alpha::blue'],
      },
    ])

    expect(applyApprovedProposal(proposal, appliedCatalog)).toEqual(
      appliedCatalog.courses,
    )
  })

  it('rejects an edit prepared from an older shared-course snapshot', () => {
    const changedCourse = {
      ...course,
      holes: { 1: { par: 5, yardage: 400 } },
    }

    expect(() =>
      createCourseProposal(
        {
          targetCourseKey: course.key,
          baseCatalogRevision: 2,
          baseCourse: course,
          proposedCourse: {
            ...course,
            holes: { 1: { par: 4, yardage: 410 } },
          },
          message: '',
        },
        { userId: 'owner', userDetails: 'golfer@example.com' },
        makeCatalog([changedCourse]),
      ),
    ).toThrow(ProposalConflictError)
  })

  it('rejects a course key that does not match its name and tee', () => {
    expect(() =>
      createCourseProposal(
        {
          targetCourseKey: null,
          baseCatalogRevision: 3,
          baseCourse: null,
          proposedCourse: { ...course, key: 'malicious-key' },
          message: '',
        },
        { userId: 'owner', userDetails: 'golfer@example.com' },
        makeCatalog([]),
      ),
    ).toThrow('Course key must match')
  })

  it('removes golfer-supplied aliases from proposals', () => {
    const proposal = createCourseProposal(
      {
        targetCourseKey: null,
        baseCatalogRevision: 3,
        baseCourse: null,
        proposedCourse: {
          ...course,
          aliases: ['another-course::blue'],
        },
        message: '',
      },
      { userId: 'owner', userDetails: 'golfer@example.com' },
      makeCatalog([]),
    )

    expect(proposal.proposedCourse).toEqual(course)
  })

  it('does not treat a rename as applied while the source still exists', () => {
    const catalog = makeCatalog([course])
    const proposal = createCourseProposal(
      {
        targetCourseKey: course.key,
        baseCatalogRevision: 3,
        baseCourse: course,
        proposedCourse: {
          ...course,
          key: 'alpha::gold',
          teeName: 'Gold',
        },
        message: '',
      },
      { userId: 'owner', userDetails: 'golfer@example.com' },
      catalog,
    )
    const destination = {
      ...(proposal.proposedCourse as object),
      aliases: ['alpha::blue'],
    }

    expect(() =>
      applyApprovedProposal(proposal, makeCatalog([course, destination])),
    ).toThrow('proposed name and tee')
  })
})

function makeCatalog(courses: unknown[]): StoredCourseCatalog {
  return {
    id: 'catalog',
    courses,
    revision: 3,
    updatedAt: '2026-09-17T00:00:00Z',
  }
}
