import { randomUUID } from 'node:crypto'
import {
  validateCourseTemplate,
  type StoredCourseCatalog,
} from './courseCatalogModel.js'
import { ValidationError } from './stateModel.js'

export type CourseProposalStatus =
  | 'pending'
  | 'changes-requested'
  | 'approving'
  | 'approved'
  | 'rejected'
  | 'withdrawn'

export interface CourseProposal {
  id: string
  proposerId: string
  proposerDetails: string
  type: 'create' | 'edit'
  status: CourseProposalStatus
  targetCourseKey: string | null
  baseCatalogRevision: number
  baseCourse: unknown | null
  proposedCourse: unknown
  message: string
  submittedAt: string
  reviewedAt: string | null
  reviewerId: string | null
  reviewNote: string | null
  _etag?: string
}

export interface CreateCourseProposalPayload {
  targetCourseKey: string | null
  baseCatalogRevision: number
  baseCourse: unknown | null
  proposedCourse: unknown
  message: string
}

export type ReviewAction =
  | 'approve'
  | 'reject'
  | 'request-changes'
  | 'withdraw'

export function validateCreateCourseProposal(
  value: unknown,
): CreateCourseProposalPayload {
  if (!isRecord(value)) {
    throw new ValidationError('Request body must be an object.')
  }
  const allowedKeys = new Set([
    'targetCourseKey',
    'baseCatalogRevision',
    'baseCourse',
    'proposedCourse',
    'message',
  ])
  const unexpectedKey = Object.keys(value).find((key) => !allowedKeys.has(key))
  if (unexpectedKey) {
    throw new ValidationError(`Unexpected property: ${unexpectedKey}.`)
  }
  if (
    value.targetCourseKey !== null &&
    (typeof value.targetCourseKey !== 'string' ||
      value.targetCourseKey.length === 0 ||
      value.targetCourseKey.length > 1_000)
  ) {
    throw new ValidationError('targetCourseKey must be null or a course key.')
  }
  if (
    !Number.isSafeInteger(value.baseCatalogRevision) ||
    (value.baseCatalogRevision as number) < 0
  ) {
    throw new ValidationError(
      'baseCatalogRevision must be a non-negative integer.',
    )
  }
  const baseCourse =
    value.baseCourse === null ? null : validateCourseTemplate(value.baseCourse)
  if (
    (value.targetCourseKey === null && baseCourse !== null) ||
    (value.targetCourseKey !== null && baseCourse === null)
  ) {
    throw new ValidationError(
      'baseCourse must be supplied only for shared-course edits.',
    )
  }
  if (
    typeof value.message !== 'string' ||
    value.message.length > 500
  ) {
    throw new ValidationError('message must be 500 characters or fewer.')
  }

  return {
    targetCourseKey: value.targetCourseKey,
    baseCatalogRevision: value.baseCatalogRevision as number,
    baseCourse,
    proposedCourse: validateCourseTemplate(value.proposedCourse),
    message: value.message.trim(),
  }
}

export function validateReviewAction(value: unknown): {
  action: ReviewAction
  note: string
} {
  if (!isRecord(value)) {
    throw new ValidationError('Request body must be an object.')
  }
  const unexpectedKey = Object.keys(value).find(
    (key) => key !== 'action' && key !== 'note',
  )
  if (unexpectedKey) {
    throw new ValidationError(`Unexpected property: ${unexpectedKey}.`)
  }
  if (
    value.action !== 'approve' &&
    value.action !== 'reject' &&
    value.action !== 'request-changes' &&
    value.action !== 'withdraw'
  ) {
    throw new ValidationError('Unknown proposal action.')
  }
  if (typeof value.note !== 'string' || value.note.length > 500) {
    throw new ValidationError('note must be 500 characters or fewer.')
  }
  return { action: value.action, note: value.note.trim() }
}

export function createCourseProposal(
  payload: CreateCourseProposalPayload,
  proposer: { userId: string; userDetails: string },
  catalog: StoredCourseCatalog | null,
): CourseProposal {
  const courses = (catalog?.courses ?? []) as Array<{ key: string }>
  const currentCourse = payload.targetCourseKey
    ? courses.find((course) => course.key === payload.targetCourseKey) ?? null
    : null
  if (payload.targetCourseKey && !currentCourse) {
    throw new ProposalConflictError('The shared course no longer exists.')
  }
  if (
    payload.targetCourseKey &&
    JSON.stringify(currentCourse) !== JSON.stringify(payload.baseCourse)
  ) {
    throw new ProposalConflictError(
      'The shared course changed while this edit was being prepared.',
    )
  }
  if (
    payload.baseCatalogRevision > (catalog?.revision ?? 0)
  ) {
    throw new ProposalConflictError('The shared course catalog is out of date.')
  }
  const proposedCourse = withoutAliases(payload.proposedCourse)
  assertNormalizedCourseKey(proposedCourse)

  return {
    id: `proposal-${randomUUID()}`,
    proposerId: proposer.userId,
    proposerDetails: proposer.userDetails,
    type: payload.targetCourseKey ? 'edit' : 'create',
    status: 'pending',
    targetCourseKey: payload.targetCourseKey,
    baseCatalogRevision: payload.baseCatalogRevision,
    baseCourse: payload.baseCourse,
    proposedCourse,
    message: payload.message,
    submittedAt: new Date().toISOString(),
    reviewedAt: null,
    reviewerId: null,
    reviewNote: null,
  }
}

export function applyApprovedProposal(
  proposal: CourseProposal,
  catalog: StoredCourseCatalog | null,
): unknown[] {
  const courses = [...(catalog?.courses ?? [])] as Array<{
    key: string
    aliases?: string[]
  }>
  const proposed = proposal.proposedCourse as {
    key: string
    aliases?: string[]
  }
  const expectedProposed =
    proposal.type === 'edit'
      ? withPreservedAliases(
          proposed,
          proposal.baseCourse as { aliases?: string[] },
          proposal.targetCourseKey!,
        )
      : proposed
  const alreadyApplied = courses.find(
    (course) =>
      course.key === expectedProposed.key &&
      JSON.stringify(course) === JSON.stringify(expectedProposed),
  )
  if (
    alreadyApplied &&
    (proposal.type === 'create' ||
      proposal.targetCourseKey === expectedProposed.key ||
      !courses.some((course) => course.key === proposal.targetCourseKey))
  ) {
    return courses
  }

  if (proposal.type === 'create') {
    if (courses.some((course) => usesCourseIdentity(course, proposed.key))) {
      throw new ProposalConflictError(
        'A shared course with this name and tee already exists.',
      )
    }
    return sortCourses([...courses, proposed])
  }

  const currentIndex = courses.findIndex(
    (course) => course.key === proposal.targetCourseKey,
  )
  if (currentIndex === -1) {
    throw new ProposalConflictError('The shared course no longer exists.')
  }
  if (
    JSON.stringify(courses[currentIndex]) !== JSON.stringify(proposal.baseCourse)
  ) {
    throw new ProposalConflictError(
      'The shared course changed after this proposal was submitted.',
    )
  }
  if (
    proposed.key !== proposal.targetCourseKey &&
    courses.some(
      (course, index) =>
        index !== currentIndex && usesCourseIdentity(course, proposed.key),
    )
  ) {
    throw new ProposalConflictError(
      'Another shared course already uses the proposed name and tee.',
    )
  }

  return sortCourses([
    ...courses.slice(0, currentIndex),
    expectedProposed,
    ...courses.slice(currentIndex + 1),
  ])
}

export class ProposalConflictError extends Error {}

function sortCourses<T extends { key: string }>(courses: T[]): T[] {
  return courses.sort((a, b) => a.key.localeCompare(b.key))
}

function withPreservedAliases<T extends { key: string; aliases?: string[] }>(
  proposed: T,
  base: { aliases?: string[] },
  targetCourseKey: string,
): T {
  const aliases = [
    ...new Set([
      ...(proposed.aliases ?? []),
      ...(base.aliases ?? []),
      ...(proposed.key === targetCourseKey ? [] : [targetCourseKey]),
    ]),
  ].slice(-100)
  return {
    ...proposed,
    ...(aliases.length ? { aliases } : {}),
  }
}

function assertNormalizedCourseKey(course: unknown): void {
  const value = course as { key: string; name: string; teeName: string }
  const expectedKey =
    `${value.name.trim().toLocaleLowerCase()}::` +
    value.teeName.trim().toLocaleLowerCase()
  if (value.key !== expectedKey) {
    throw new ValidationError(
      'Course key must match the normalized course and tee names.',
    )
  }
}

function withoutAliases(course: unknown): unknown {
  const { aliases: _aliases, ...sanitized } = course as {
    aliases?: string[]
    [key: string]: unknown
  }
  return sanitized
}

function usesCourseIdentity(
  course: { key: string; aliases?: string[] },
  key: string,
): boolean {
  return course.key === key || course.aliases?.includes(key) === true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
