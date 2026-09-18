import { randomUUID } from 'node:crypto'
import {
  CourseConflictError,
  normalizedCourseKey,
  type PublishedCourseTemplate,
} from './courseCatalogV2Model.js'
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
  targetCourseId: string | null
  targetTeeId: string | null
  baseCourseRevision: number
  baseCourse: PublishedCourseTemplate | null
  proposedCourse: PublishedCourseTemplate
  message: string
  submittedAt: string
  reviewedAt: string | null
  reviewerId: string | null
  reviewNote: string | null
  targetCourseKey?: string | null
  baseCatalogRevision?: number
  _etag?: string
}

export interface CreateCourseProposalPayload {
  targetCourseId: string | null
  targetTeeId: string | null
  targetCourseKey: string | null
  baseCourseRevision: number
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
    'targetCourseId',
    'targetTeeId',
    'targetCourseKey',
    'baseCourseRevision',
    'baseCatalogRevision',
    'baseCourse',
    'proposedCourse',
    'message',
  ])
  const unexpectedKey = Object.keys(value).find((key) => !allowedKeys.has(key))
  if (unexpectedKey) {
    throw new ValidationError(`Unexpected property: ${unexpectedKey}.`)
  }
  const targetCourseId = nullableId(value.targetCourseId, 'course')
  const targetTeeId = nullableId(value.targetTeeId, 'tee')
  const targetCourseKey = nullableLegacyKey(value.targetCourseKey)
  if ((targetCourseId === null) !== (targetTeeId === null)) {
    throw new ValidationError(
      'targetCourseId and targetTeeId must be supplied together.',
    )
  }
  const hasImmutableTarget = targetCourseId !== null
  const hasLegacyTarget = targetCourseKey !== null
  if (hasImmutableTarget && hasLegacyTarget) {
    throw new ValidationError(
      'Use immutable course IDs instead of a legacy target key.',
    )
  }
  const baseCourseRevision = optionalRevision(
    value.baseCourseRevision,
    hasImmutableTarget ? null : 0,
    'baseCourseRevision',
  )
  const baseCatalogRevision = optionalRevision(
    value.baseCatalogRevision,
    0,
    'baseCatalogRevision',
  )
  const baseCourse = value.baseCourse === null
    ? null
    : validateProposalTemplate(value.baseCourse)
  if ((hasImmutableTarget || hasLegacyTarget) !== (baseCourse !== null)) {
    throw new ValidationError(
      'baseCourse must be supplied only for shared-course edits.',
    )
  }
  if (typeof value.message !== 'string' || value.message.length > 500) {
    throw new ValidationError('message must be 500 characters or fewer.')
  }

  return {
    targetCourseId,
    targetTeeId,
    targetCourseKey,
    baseCourseRevision,
    baseCatalogRevision,
    baseCourse,
    proposedCourse: validateProposalTemplate(value.proposedCourse),
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
  courses: PublishedCourseTemplate[],
): CourseProposal {
  const current = resolveTarget(payload, courses)
  if ((payload.targetCourseId || payload.targetCourseKey) && !current) {
    throw new ProposalConflictError('The shared course no longer exists.')
  }
  if (current) {
    if (
      payload.targetCourseId &&
      current.revision !== payload.baseCourseRevision
    ) {
      throw new ProposalConflictError(
        'The shared course changed while this edit was being prepared.',
      )
    }
    if (!sameSnapshot(current, payload.baseCourse)) {
      throw new ProposalConflictError(
        'The shared course changed while this edit was being prepared.',
      )
    }
  }

  const proposedInput = payload.proposedCourse as ProposalTemplate
  assertNormalizedCourseKey(proposedInput)
  const courseId = current?.courseId ?? `course-${randomUUID()}`
  const teeId = current?.teeId ?? `tee-${randomUUID()}`
  const proposedCourse: PublishedCourseTemplate = {
    key: proposedInput.key,
    name: proposedInput.name.trim(),
    teeName: proposedInput.teeName.trim(),
    holes: cloneHoles(proposedInput.holes),
    courseId,
    teeId,
    revision: current?.revision ?? 0,
  }
  if (!current) assertNoProposedIdentityCollision(proposedCourse, courses)

  return {
    id: `proposal-${randomUUID()}`,
    proposerId: proposer.userId,
    proposerDetails: proposer.userDetails,
    type: current ? 'edit' : 'create',
    status: 'pending',
    targetCourseId: current?.courseId ?? null,
    targetTeeId: current?.teeId ?? null,
    baseCourseRevision: current?.revision ?? 0,
    baseCourse: current,
    proposedCourse,
    message: payload.message,
    submittedAt: new Date().toISOString(),
    reviewedAt: null,
    reviewerId: null,
    reviewNote: null,
    ...(payload.targetCourseKey
      ? { targetCourseKey: payload.targetCourseKey }
      : {}),
    ...(payload.baseCatalogRevision
      ? { baseCatalogRevision: payload.baseCatalogRevision }
      : {}),
  }
}

export function proposalExpectedTemplate(
  proposal: CourseProposal,
  current?: PublishedCourseTemplate | null,
): PublishedCourseTemplate {
  if (proposal.type === 'create') return proposal.proposedCourse
  const base = proposal.baseCourse
  if (!base) {
    throw new ProposalConflictError(
      'This legacy proposal has no base snapshot and must be resubmitted.',
    )
  }
  const proposed = proposal.proposedCourse
  const aliases = [
    ...new Set([
      ...(base.aliases ?? []),
      ...(proposed.key === base.key ? [] : [base.key]),
    ]),
  ].filter((alias) => alias !== proposed.key).slice(-100)
  return {
    ...proposed,
    ...(aliases.length ? { aliases } : {}),
    courseId: base.courseId ?? current?.courseId ?? proposed.courseId,
    teeId: base.teeId ?? current?.teeId ?? proposed.teeId,
    revision: (base.revision ?? current?.revision ?? 0) + 1,
  }
}

export function proposalAlreadyApplied(
  proposal: CourseProposal,
  current: PublishedCourseTemplate | null,
): boolean {
  if (!current) return false
  return sameTemplate(current, proposalExpectedTemplate(proposal, current))
}

export function assertProposalCanUpdate(
  proposal: CourseProposal,
  current: PublishedCourseTemplate | null,
): asserts current is PublishedCourseTemplate {
  if (!current) {
    throw new ProposalConflictError('The shared course no longer exists.')
  }
  if (!proposal.targetCourseId || !proposal.targetTeeId) {
    if (
      proposal.targetCourseKey &&
      sameLegacySnapshot(
        current,
        proposal.baseCourse,
        proposal.targetCourseKey,
      )
    ) {
      return
    }

    function sameLegacySnapshot(
      current: PublishedCourseTemplate,
      supplied: unknown,
      targetKey: string,
    ): boolean {
      if (!supplied) return false
      const candidate = supplied as Partial<PublishedCourseTemplate>
      const currentIdentities = new Set([
        current.key,
        ...(current.aliases ?? []),
      ])
      return (
        currentIdentities.has(targetKey) &&
        typeof candidate.key === 'string' &&
        currentIdentities.has(candidate.key) &&
        current.name === candidate.name &&
        current.teeName === candidate.teeName &&
        JSON.stringify(current.holes) === JSON.stringify(candidate.holes)
      )
    }
    throw new ProposalConflictError(
      'This legacy proposal must be resubmitted with immutable course IDs.',
    )
  }
  if (
    current.revision !== proposal.baseCourseRevision ||
    !sameTemplate(current, proposal.baseCourse)
  ) {
    throw new ProposalConflictError(
      'The shared course changed after this proposal was submitted.',
    )
  }
}

export class ProposalConflictError extends CourseConflictError {}

interface ProposalTemplate {
  key: string
  name: string
  teeName: string
  holes: Record<string, { par: number; yardage: number }>
  aliases?: string[]
  courseId?: string
  teeId?: string
  revision?: number
}

function resolveTarget(
  payload: CreateCourseProposalPayload,
  courses: PublishedCourseTemplate[],
): PublishedCourseTemplate | null {
  if (payload.targetCourseId && payload.targetTeeId) {
    return (
      courses.find(
        (course) =>
          course.courseId === payload.targetCourseId &&
          course.teeId === payload.targetTeeId,
      ) ?? null
    )
  }
  if (payload.targetCourseKey) {
    const matches = courses.filter(
      (course) =>
        course.key === payload.targetCourseKey ||
        course.aliases?.includes(payload.targetCourseKey!) === true,
    )
    if (matches.length > 1) {
      throw new ProposalConflictError(
        'The legacy shared-course identity is ambiguous.',
      )
    }
    return matches[0] ?? null
  }
  return null
}

function validateProposalTemplate(value: unknown): ProposalTemplate {
  if (!isRecord(value) || !isRecord(value.holes)) {
    throw new ValidationError('Course proposal contains an invalid course.')
  }
  const allowed = new Set([
    'key',
    'name',
    'teeName',
    'holes',
    'aliases',
    'courseId',
    'teeId',
    'revision',
  ])
  const unexpectedKey = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpectedKey) {
    throw new ValidationError(
      `Unexpected course property: ${unexpectedKey}.`,
    )
  }
  if (
    !isShortString(value.key, 1_000) ||
    !isShortString(value.name, 500) ||
    !isShortString(value.teeName, 500)
  ) {
    throw new ValidationError('Course proposal contains an invalid course.')
  }
  const holes = Object.entries(value.holes)
  if (
    holes.length > 18 ||
    holes.some(
      ([number, hole]) =>
        !/^(?:[1-9]|1[0-8])$/.test(number) ||
        !isRecord(hole) ||
        !isNumberInRange(hole.par, 0, 10) ||
        !isNumberInRange(hole.yardage, 0, 2_000),
    )
  ) {
    throw new ValidationError('Course proposal contains an invalid course.')
  }
  const aliases =
    value.aliases === undefined
      ? undefined
      : Array.isArray(value.aliases) &&
          value.aliases.length <= 100 &&
          value.aliases.every((alias) => isShortString(alias, 1_000))
        ? [...new Set(value.aliases)]
        : null
  if (aliases === null) {
    throw new ValidationError('Course proposal contains invalid aliases.')
  }
  const courseId =
    value.courseId === undefined
      ? undefined
      : validateTemplateId(value.courseId, 'course')
  const teeId =
    value.teeId === undefined
      ? undefined
      : validateTemplateId(value.teeId, 'tee')
  if ((courseId === undefined) !== (teeId === undefined)) {
    throw new ValidationError(
      'Course proposal identities must be supplied together.',
    )
  }
  const revision =
    value.revision === undefined
      ? undefined
      : optionalRevision(value.revision, null, 'course revision')
  return {
    key: value.key,
    name: value.name,
    teeName: value.teeName,
    holes: Object.fromEntries(
      holes.map(([number, hole]) => [
        number,
        {
          par: (hole as Record<string, number>).par,
          yardage: (hole as Record<string, number>).yardage,
        },
      ]),
    ),
    ...(aliases?.length ? { aliases } : {}),
    ...(courseId ? { courseId } : {}),
    ...(teeId ? { teeId } : {}),
    ...(revision === undefined ? {} : { revision }),
  }
}

function assertNormalizedCourseKey(course: ProposalTemplate): void {
  if (course.key !== normalizedCourseKey(course.name, course.teeName)) {
    throw new ValidationError(
      'Course key must match the normalized course and tee names.',
    )
  }
}

function assertNoProposedIdentityCollision(
  proposed: PublishedCourseTemplate,
  courses: PublishedCourseTemplate[],
): void {
  if (
    courses.some(
      (course) =>
        course.key === proposed.key ||
        course.aliases?.includes(proposed.key) === true,
    )
  ) {
    throw new ProposalConflictError(
      'A shared course with this name and tee already exists.',
    )
  }
}

function sameSnapshot(
  current: PublishedCourseTemplate,
  supplied: unknown,
): boolean {
  if (!supplied) return false
  const candidate = supplied as Partial<PublishedCourseTemplate>
  return (
    current.key === candidate.key &&
    current.name === candidate.name &&
    current.teeName === candidate.teeName &&
    JSON.stringify(current.holes) === JSON.stringify(candidate.holes) &&
    JSON.stringify(current.aliases ?? []) ===
      JSON.stringify(candidate.aliases ?? []) &&
    (candidate.courseId === undefined ||
      candidate.courseId === current.courseId) &&
    (candidate.teeId === undefined || candidate.teeId === current.teeId) &&
    (candidate.revision === undefined ||
      candidate.revision === current.revision)
  )
}

function sameTemplate(
  left: PublishedCourseTemplate,
  right: PublishedCourseTemplate | null,
): boolean {
  if (!right) return false
  return (
    left.key === right.key &&
    left.name === right.name &&
    left.teeName === right.teeName &&
    left.courseId === right.courseId &&
    left.teeId === right.teeId &&
    JSON.stringify(left.holes) === JSON.stringify(right.holes) &&
    JSON.stringify(left.aliases ?? []) ===
      JSON.stringify(right.aliases ?? [])
  )
}

function cloneHoles(
  holes: Record<string, { par: number; yardage: number }>,
): Record<string, { par: number; yardage: number }> {
  return Object.fromEntries(
    Object.entries(holes).map(([number, hole]) => [number, { ...hole }]),
  )
}

function nullableId(
  value: unknown,
  kind: 'course' | 'tee',
): string | null {
  if (value === undefined || value === null) return null
  if (
    typeof value !== 'string' ||
    !new RegExp(`^${kind}-[0-9a-f-]{36}$`, 'i').test(value)
  ) {
    throw new ValidationError(`target${capitalize(kind)}Id is invalid.`)
  }
  return value
}

function validateTemplateId(
  value: unknown,
  kind: 'course' | 'tee',
): string {
  if (
    typeof value !== 'string' ||
    !new RegExp(`^${kind}-[0-9a-f-]{36}$`, 'i').test(value)
  ) {
    throw new ValidationError(`Course proposal ${kind}Id is invalid.`)
  }
  return value
}

function nullableLegacyKey(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_000) {
    throw new ValidationError('targetCourseKey must be null or a course key.')
  }
  return value
}

function optionalRevision(
  value: unknown,
  fallback: number | null,
  field: string,
): number {
  if (value === undefined && fallback !== null) return fallback
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ValidationError(`${field} must be a non-negative integer.`)
  }
  return value as number
}

function capitalize(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isShortString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isNumberInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  )
}
