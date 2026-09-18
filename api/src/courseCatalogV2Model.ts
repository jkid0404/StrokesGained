import { createHash, randomUUID } from 'node:crypto'
import {
  PayloadTooLargeError,
  ValidationError,
} from './stateModel.js'
import type { StoredCourseCatalog } from './courseCatalogModel.js'

export type CourseStatus = 'active' | 'archived'
export type TeeStatus = 'active' | 'archived'

export interface CourseHole {
  par: number
  yardage: number
}

export interface CourseTee {
  teeId: string
  status: TeeStatus
  name: string
  holes: Record<string, CourseHole>
  key: string
  aliases?: string[]
  createdAt: string
  updatedAt: string
}

export interface StoredCourseAggregate {
  id: string
  courseId: string
  documentType: 'course'
  status: CourseStatus
  name: string
  revision: number
  createdAt: string
  updatedAt: string
  tees: CourseTee[]
  legacyCatalogRevision?: number
  _etag?: string
}

export interface PublishedCourseTemplate {
  key: string
  name: string
  teeName: string
  holes: Record<string, CourseHole>
  aliases?: string[]
  courseId: string
  teeId: string
  revision: number
}

export interface PublishedCourseCatalogResponse {
  courses: PublishedCourseTemplate[]
  revision: number
  updatedAt: string | null
  exists: boolean
}

export interface CreatePublishedCoursePayload {
  name: string
  teeName: string
  holes: Record<string, CourseHole>
}

export interface UpdatePublishedTeePayload extends CreatePublishedCoursePayload {
  revision: number
}

export type AddPublishedTeePayload = UpdatePublishedTeePayload

export interface DeletePublishedTeePayload {
  revision: number
}

const MAX_BODY_BYTES = 100_000
const MAX_COURSES = 1_000
const MAX_TEES_PER_COURSE = 100
const MAX_ALIASES = 100

export function validateCreatePublishedCoursePayload(
  value: unknown,
): CreatePublishedCoursePayload {
  return validateCourseMutationPayload(value, false)
}

export function validateUpdatePublishedTeePayload(
  value: unknown,
): UpdatePublishedTeePayload {
  return validateCourseMutationPayload(value, true)
}

export function validateAddPublishedTeePayload(
  value: unknown,
): AddPublishedTeePayload {
  return validateCourseMutationPayload(value, true)
}

export function validateDeletePublishedTeePayload(
  value: unknown,
): DeletePublishedTeePayload {
  if (!isRecord(value)) {
    throw new ValidationError('Request body must be an object.')
  }
  const unexpectedKey = Object.keys(value).find((key) => key !== 'revision')
  if (unexpectedKey) {
    throw new ValidationError(`Unexpected property: ${unexpectedKey}.`)
  }
  return { revision: validateRevision(value.revision) }
}

export function createCourseAggregate(
  payload: CreatePublishedCoursePayload,
  now = new Date().toISOString(),
  ids: { courseId?: string; teeId?: string } = {},
): StoredCourseAggregate {
  const courseId = ids.courseId ?? `course-${randomUUID()}`
  const teeId = ids.teeId ?? `tee-${randomUUID()}`
  assertId(courseId, 'courseId')
  assertId(teeId, 'teeId')
  const name = payload.name.trim()
  const teeName = payload.teeName.trim()
  const key = normalizedCourseKey(name, teeName)
  return {
    id: courseId,
    courseId,
    documentType: 'course',
    status: 'active',
    name,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    tees: [
      {
        teeId,
        status: 'active',
        name: teeName,
        holes: cloneHoles(payload.holes),
        key,
        createdAt: now,
        updatedAt: now,
      },
    ],
  }
}

export function updateCourseAggregateTee(
  current: StoredCourseAggregate,
  teeId: string,
  payload: UpdatePublishedTeePayload,
  now = new Date().toISOString(),
): StoredCourseAggregate {
  assertMatchingRevision(current, payload.revision)
  const target = current.tees.find(
    (tee) => tee.teeId === teeId && tee.status === 'active',
  )
  if (!target || current.status !== 'active') {
    throw new CourseNotFoundError('The shared course tee no longer exists.')
  }

  const nextCourseName = payload.name.trim()
  const nextTeeName = payload.teeName.trim()
  const tees = current.tees.map((tee) => {
    if (tee.status !== 'active') return tee
    const nextKey = normalizedCourseKey(
      nextCourseName,
      tee.teeId === teeId ? nextTeeName : tee.name,
    )
    const aliases = preserveAliases(tee.aliases, tee.key, nextKey)
    return {
      ...tee,
      ...(tee.teeId === teeId
        ? { name: nextTeeName, holes: cloneHoles(payload.holes) }
        : {}),
      key: nextKey,
      ...(aliases.length ? { aliases } : { aliases: undefined }),
      updatedAt: now,
    }
  })
  assertUniqueAggregateIdentities(tees)

  return {
    ...withoutEtag(current),
    name: nextCourseName,
    revision: current.revision + 1,
    updatedAt: now,
    tees,
  }
}

export function addCourseAggregateTee(
  current: StoredCourseAggregate,
  payload: AddPublishedTeePayload,
  now = new Date().toISOString(),
  teeId = `tee-${randomUUID()}`,
): StoredCourseAggregate {
  assertMatchingRevision(current, payload.revision)
  assertId(teeId, 'teeId')
  if (current.status !== 'active') {
    throw new CourseNotFoundError('The shared course no longer exists.')
  }
  const courseName = payload.name.trim()
  if (normalizeIdentity(courseName) !== normalizeIdentity(current.name)) {
    throw new ValidationError(
      'A new tee must use the existing shared course name.',
    )
  }
  const teeName = payload.teeName.trim()
  const tee: CourseTee = {
    teeId,
    status: 'active',
    name: teeName,
    holes: cloneHoles(payload.holes),
    key: normalizedCourseKey(current.name, teeName),
    createdAt: now,
    updatedAt: now,
  }
  const tees = [...current.tees, tee]
  if (tees.length > MAX_TEES_PER_COURSE) {
    throw new ValidationError('A shared course has too many tees.')
  }
  assertUniqueAggregateIdentities(
    tees.filter((item) => item.status === 'active'),
  )
  return {
    ...withoutEtag(current),
    revision: current.revision + 1,
    updatedAt: now,
    tees,
  }
}

export function archiveCourseAggregateTee(
  current: StoredCourseAggregate,
  teeId: string,
  revision: number,
  now = new Date().toISOString(),
): StoredCourseAggregate {
  assertMatchingRevision(current, revision)
  const target = current.tees.find(
    (tee) => tee.teeId === teeId && tee.status === 'active',
  )
  if (!target || current.status !== 'active') {
    throw new CourseNotFoundError('The shared course tee no longer exists.')
  }
  const tees = current.tees.map((tee) =>
    tee.teeId === teeId
      ? { ...tee, status: 'archived' as const, updatedAt: now }
      : tee,
  )
  return {
    ...withoutEtag(current),
    status: tees.some((tee) => tee.status === 'active') ? 'active' : 'archived',
    revision: current.revision + 1,
    updatedAt: now,
    tees,
  }
}

export function flattenCourseAggregate(
  course: StoredCourseAggregate,
): PublishedCourseTemplate[] {
  if (course.status !== 'active') return []
  return course.tees
    .filter((tee) => tee.status === 'active')
    .map((tee) => ({
      key: tee.key,
      name: course.name,
      teeName: tee.name,
      holes: cloneHoles(tee.holes),
      ...(tee.aliases?.length ? { aliases: [...tee.aliases] } : {}),
      courseId: course.courseId,
      teeId: tee.teeId,
      revision: course.revision,
    }))
}

export function toPublishedCourseCatalogResponse(
  aggregates: StoredCourseAggregate[],
): PublishedCourseCatalogResponse {
  const courses = aggregates
    .flatMap(flattenCourseAggregate)
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.teeName.localeCompare(b.teeName),
    )
  return {
    courses,
    revision: aggregates.reduce(
      (total, course) => total + course.revision,
      0,
    ),
    updatedAt:
      aggregates.reduce<string | null>(
        (latest, course) =>
          latest === null || course.updatedAt > latest
            ? course.updatedAt
            : latest,
        null,
      ),
    exists: aggregates.length > 0,
  }
}

export function convertLegacyCatalog(
  catalog: StoredCourseCatalog,
): StoredCourseAggregate[] {
  if (catalog.courses.length > MAX_COURSES) {
    throw new ValidationError('The legacy catalog has too many courses.')
  }
  const groups = new Map<string, StoredCourseAggregate>()
  for (const value of catalog.courses) {
    const legacy = validateLegacyTemplate(value)
    const courseIdentity = normalizeIdentity(legacy.name)
    const courseId = deterministicCatalogId('course', courseIdentity)
    const current =
      groups.get(courseIdentity) ??
      ({
        id: courseId,
        courseId,
        documentType: 'course',
        status: 'active',
        name: legacy.name.trim(),
        revision: 1,
        createdAt: catalog.updatedAt,
        updatedAt: catalog.updatedAt,
        tees: [],
        legacyCatalogRevision: catalog.revision,
      } satisfies StoredCourseAggregate)
    const teeId = deterministicCatalogId('tee', legacy.key)
    const normalizedKey = normalizedCourseKey(current.name, legacy.teeName)
    const aliases = [
      ...new Set([
        ...(legacy.aliases ?? []),
        ...(legacy.key === normalizedKey ? [] : [legacy.key]),
      ]),
    ]
      .filter((alias) => alias !== normalizedKey)
      .slice(-MAX_ALIASES)
    if (!current.tees.some((tee) => tee.teeId === teeId)) {
      current.tees.push({
        teeId,
        status: 'active',
        name: legacy.teeName.trim(),
        holes: cloneHoles(legacy.holes),
        key: normalizedKey,
        ...(aliases.length ? { aliases } : {}),
        createdAt: catalog.updatedAt,
        updatedAt: catalog.updatedAt,
      })
    }
    groups.set(courseIdentity, current)
  }

  const aggregates = [...groups.values()]
  for (const aggregate of aggregates) {
    aggregate.tees.sort((a, b) => a.teeId.localeCompare(b.teeId))
    if (aggregate.tees.length > MAX_TEES_PER_COURSE) {
      throw new ValidationError('A migrated course has too many tees.')
    }
    assertUniqueAggregateIdentities(aggregate.tees)
  }
  for (const aggregate of aggregates) {
    assertNoIdentityCollisions(aggregate, aggregates)
  }
  return aggregates.sort((a, b) => a.courseId.localeCompare(b.courseId))
}

export function deterministicCatalogId(
  kind: 'course' | 'tee',
  identity: string,
): string {
  const hex = createHash('sha256')
    .update(`golf-strokes-gained:${kind}:${normalizeIdentity(identity)}`)
    .digest('hex')
    .slice(0, 32)
    .split('')
  hex[12] = '5'
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4]
  const uuid = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
  return `${kind}-${uuid}`
}

export function normalizedCourseKey(name: string, teeName: string): string {
  return `${normalizeIdentity(name)}::${normalizeIdentity(teeName)}`
}

export function courseUsesIdentity(
  course: StoredCourseAggregate,
  identity: string,
): boolean {
  return course.tees.some(
    (tee) => tee.key === identity || tee.aliases?.includes(identity) === true,
  )
}

export function assertNoIdentityCollisions(
  candidate: StoredCourseAggregate,
  allCourses: StoredCourseAggregate[],
): void {
  const identities = candidate.tees.flatMap((tee) => [
    tee.key,
    ...(tee.aliases ?? []),
  ])
  for (const identity of identities) {
    if (
      allCourses.some(
        (course) =>
          course.courseId !== candidate.courseId &&
          courseUsesIdentity(course, identity),
      )
    ) {
      throw new CourseConflictError(
        'Another shared course already uses this course and tee identity.',
      )
    }
  }
}

export class CourseConflictError extends Error {
  readonly current: StoredCourseAggregate | null

  constructor(message: string, current: StoredCourseAggregate | null = null) {
    super(message)
    this.current = current
  }
}

export class CourseNotFoundError extends Error {}

function validateCourseMutationPayload(
  value: unknown,
  includeRevision: false,
): CreatePublishedCoursePayload
function validateCourseMutationPayload(
  value: unknown,
  includeRevision: true,
): UpdatePublishedTeePayload
function validateCourseMutationPayload(
  value: unknown,
  includeRevision: boolean,
): CreatePublishedCoursePayload | UpdatePublishedTeePayload {
  if (!isRecord(value)) {
    throw new ValidationError('Request body must be an object.')
  }
  const allowed = new Set([
    'name',
    'teeName',
    'holes',
    ...(includeRevision ? ['revision'] : []),
  ])
  const unexpectedKey = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpectedKey) {
    throw new ValidationError(`Unexpected property: ${unexpectedKey}.`)
  }
  const name = validateName(value.name, 'name')
  const teeName = validateName(value.teeName, 'teeName')
  const holes = validateHoles(value.holes)
  assertBodySize(value)
  return includeRevision
    ? { name, teeName, holes, revision: validateRevision(value.revision) }
    : { name, teeName, holes }
}

function validateLegacyTemplate(value: unknown): {
  key: string
  name: string
  teeName: string
  holes: Record<string, CourseHole>
  aliases?: string[]
} {
  if (!isRecord(value)) {
    throw new ValidationError('Legacy catalog contains an invalid course.')
  }
  const key = validateIdentity(value.key, 'legacy course key')
  const name = validateName(value.name, 'legacy course name')
  const teeName = validateName(value.teeName, 'legacy tee name')
  const holes = validateHoles(value.holes)
  const aliases =
    value.aliases === undefined
      ? undefined
      : validateAliases(value.aliases, 'legacy aliases')
  return { key, name, teeName, holes, ...(aliases ? { aliases } : {}) }
}

function validateName(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > 500
  ) {
    throw new ValidationError(`${field} must be 1 to 500 characters.`)
  }
  return value.trim()
}

function validateIdentity(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_000) {
    throw new ValidationError(`${field} is invalid.`)
  }
  return value
}

function validateAliases(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_ALIASES ||
    !value.every(
      (alias) =>
        typeof alias === 'string' && alias.length > 0 && alias.length <= 1_000,
    )
  ) {
    throw new ValidationError(`${field} is invalid.`)
  }
  return [...new Set(value)]
}

function validateHoles(value: unknown): Record<string, CourseHole> {
  if (!isRecord(value)) {
    throw new ValidationError('holes must be an object.')
  }
  const entries = Object.entries(value)
  if (
    entries.length > 18 ||
    entries.some(
      ([number, hole]) =>
        !/^(?:[1-9]|1[0-8])$/.test(number) ||
        !isRecord(hole) ||
        !isNumberInRange(hole.par, 0, 10) ||
        !isNumberInRange(hole.yardage, 0, 2_000),
    )
  ) {
    throw new ValidationError('holes contains invalid hole details.')
  }
  return Object.fromEntries(
    entries.map(([number, hole]) => [
      number,
      {
        par: (hole as Record<string, number>).par,
        yardage: (hole as Record<string, number>).yardage,
      },
    ]),
  )
}

function validateRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ValidationError('revision must be a positive integer.')
  }
  return value as number
}

function assertMatchingRevision(
  current: StoredCourseAggregate,
  revision: number,
): void {
  if (current.revision !== revision) {
    throw new CourseConflictError(
      'The shared course changed elsewhere.',
      current,
    )
  }
}

function assertUniqueAggregateIdentities(tees: CourseTee[]): void {
  const identities = new Set<string>()
  const teeIds = new Set<string>()
  for (const tee of tees) {
    if (teeIds.has(tee.teeId)) {
      throw new ValidationError('A course cannot contain duplicate tee IDs.')
    }
    teeIds.add(tee.teeId)
    for (const identity of [tee.key, ...(tee.aliases ?? [])]) {
      if (identities.has(identity)) {
        throw new CourseConflictError(
          'A course cannot contain duplicate active tee identities.',
        )
      }
      identities.add(identity)
    }
  }
}

function preserveAliases(
  aliases: string[] | undefined,
  oldKey: string,
  nextKey: string,
): string[] {
  return [
    ...new Set([
      ...(aliases ?? []),
      ...(oldKey === nextKey ? [] : [oldKey]),
    ]),
  ]
    .filter((alias) => alias !== nextKey)
    .slice(-MAX_ALIASES)
}

function cloneHoles(
  holes: Record<string, CourseHole>,
): Record<string, CourseHole> {
  return Object.fromEntries(
    Object.entries(holes).map(([number, hole]) => [number, { ...hole }]),
  )
}

function withoutEtag(
  course: StoredCourseAggregate,
): Omit<StoredCourseAggregate, '_etag'> {
  const { _etag: _ignored, ...persisted } = course
  return persisted
}

function normalizeIdentity(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

function assertId(value: string, field: string): void {
  if (!/^(?:course|tee)-[0-9a-f-]{36}$/i.test(value)) {
    throw new ValidationError(`${field} is invalid.`)
  }
}

function assertBodySize(value: unknown): void {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_BODY_BYTES) {
    throw new PayloadTooLargeError('Course mutation exceeds the 100 KB limit.')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
