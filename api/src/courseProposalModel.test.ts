import { describe, expect, it } from 'vitest'
import {
  assertProposalCanUpdate,
  createCourseProposal,
  proposalAlreadyApplied,
  proposalExpectedTemplate,
  ProposalConflictError,
  validateCreateCourseProposal,
} from './courseProposalModel.js'
import type { PublishedCourseTemplate } from './courseCatalogV2Model.js'

const course: PublishedCourseTemplate = {
  key: 'alpha::blue',
  name: 'Alpha',
  teeName: 'Blue',
  holes: { 1: { par: 4, yardage: 400 } },
  courseId: 'course-11111111-1111-5111-8111-111111111111',
  teeId: 'tee-22222222-2222-5222-8222-222222222222',
  revision: 3,
}

describe('course proposal model', () => {
  it('creates an immutable-ID edit proposal from the current shared course', () => {
    const proposal = createCourseProposal(
      validateCreateCourseProposal({
        targetCourseId: course.courseId,
        targetTeeId: course.teeId,
        baseCourseRevision: course.revision,
        baseCourse: course,
        proposedCourse: {
          ...course,
          holes: { 1: { par: 4, yardage: 410 } },
        },
        message: 'Corrected hole one.',
      }),
      { userId: 'owner', userDetails: 'golfer@example.com' },
      [course],
    )

    expect(proposal).toMatchObject({
      type: 'edit',
      targetCourseId: course.courseId,
      targetTeeId: course.teeId,
      baseCourseRevision: 3,
    })
    expect(proposal.proposedCourse.courseId).toBe(course.courseId)
    expect(proposal.proposedCourse.teeId).toBe(course.teeId)
  })

  it('assigns immutable IDs to new-course proposals for idempotent approval', () => {
    const proposal = createCourseProposal(
      validateCreateCourseProposal({
        targetCourseId: null,
        targetTeeId: null,
        baseCourseRevision: 0,
        baseCourse: null,
        proposedCourse: {
          key: 'alpha::blue',
          name: 'Alpha',
          teeName: 'Blue',
          holes: {},
        },
        message: '',
      }),
      { userId: 'owner', userDetails: 'golfer@example.com' },
      [],
    )

    expect(proposal.proposedCourse.courseId).toMatch(/^course-/)
    expect(proposal.proposedCourse.teeId).toMatch(/^tee-/)
    expect(
      proposalAlreadyApplied(proposal, {
        ...proposal.proposedCourse,
        revision: 1,
      }),
    ).toBe(true)
  })

  it('preserves hidden aliases when an approved edit renames a tee', () => {
    const proposal = createCourseProposal(
      validateCreateCourseProposal({
        targetCourseId: course.courseId,
        targetTeeId: course.teeId,
        baseCourseRevision: course.revision,
        baseCourse: course,
        proposedCourse: {
          ...course,
          key: 'alpha::gold',
          teeName: 'Gold',
        },
        message: '',
      }),
      { userId: 'owner', userDetails: 'golfer@example.com' },
      [course],
    )

    expect(proposal.proposedCourse.aliases).toBeUndefined()
    expect(proposalExpectedTemplate(proposal).aliases).toEqual([
      'alpha::blue',
    ])
  })

  it('rejects stale edits instead of overwriting newer course data', () => {
    const proposal = createCourseProposal(
      validateCreateCourseProposal({
        targetCourseId: course.courseId,
        targetTeeId: course.teeId,
        baseCourseRevision: course.revision,
        baseCourse: course,
        proposedCourse: {
          ...course,
          holes: { 1: { par: 4, yardage: 410 } },
        },
        message: '',
      }),
      { userId: 'owner', userDetails: 'golfer@example.com' },
      [course],
    )

    expect(() =>
      assertProposalCanUpdate(proposal, {
        ...course,
        revision: 4,
        holes: { 1: { par: 5, yardage: 400 } },
      }),
    ).toThrow(ProposalConflictError)
  })

  it('rejects a stale snapshot at submission', () => {
    expect(() =>
      createCourseProposal(
        validateCreateCourseProposal({
          targetCourseId: course.courseId,
          targetTeeId: course.teeId,
          baseCourseRevision: course.revision,
          baseCourse: {
            ...course,
            holes: { 1: { par: 5, yardage: 400 } },
          },
          proposedCourse: course,
          message: '',
        }),
        { userId: 'owner', userDetails: 'golfer@example.com' },
        [course],
      ),
    ).toThrow(ProposalConflictError)
  })

  it('supports safe legacy targeting at submission', () => {
    const proposal = createCourseProposal(
      validateCreateCourseProposal({
        targetCourseKey: course.key,
        baseCatalogRevision: 2,
        baseCourse: {
          key: course.key,
          name: course.name,
          teeName: course.teeName,
          holes: course.holes,
        },
        proposedCourse: {
          ...course,
          holes: { 1: { par: 4, yardage: 410 } },
        },
        message: '',
      }),
      { userId: 'owner', userDetails: 'golfer@example.com' },
      [course],
    )

    expect(proposal.targetCourseId).toBe(course.courseId)
    expect(proposal.targetTeeId).toBe(course.teeId)
  })

  it('accepts a uniquely resolved legacy edit whose snapshot still matches', () => {
    const proposal = createCourseProposal(
      validateCreateCourseProposal({
        targetCourseId: course.courseId,
        targetTeeId: course.teeId,
        baseCourseRevision: course.revision,
        baseCourse: course,
        proposedCourse: {
          ...course,
          holes: { 1: { par: 4, yardage: 410 } },
        },
        message: '',
      }),
      { userId: 'owner', userDetails: 'golfer@example.com' },
      [course],
    )
    const legacyProposal = {
      ...proposal,
      targetCourseId: null,
      targetTeeId: null,
      targetCourseKey: course.key,
      baseCourse: {
        key: course.key,
        name: course.name,
        teeName: course.teeName,
        holes: course.holes,
      },
    }

    expect(() =>
      assertProposalCanUpdate(legacyProposal, course),
    ).not.toThrow()
  })

  it('rejects malformed keys and strips golfer-controlled aliases', () => {
    expect(() =>
      createCourseProposal(
        validateCreateCourseProposal({
          targetCourseId: null,
          targetTeeId: null,
          baseCourseRevision: 0,
          baseCourse: null,
          proposedCourse: { ...course, key: 'malicious-key' },
          message: '',
        }),
        { userId: 'owner', userDetails: 'golfer@example.com' },
        [],
      ),
    ).toThrow('Course key must match')

    const proposal = createCourseProposal(
      validateCreateCourseProposal({
        targetCourseId: null,
        targetTeeId: null,
        baseCourseRevision: 0,
        baseCourse: null,
        proposedCourse: {
          ...course,
          aliases: ['hidden::identity'],
        },
        message: '',
      }),
      { userId: 'owner', userDetails: 'golfer@example.com' },
      [],
    )
    expect(proposal.proposedCourse.aliases).toBeUndefined()
  })
})
