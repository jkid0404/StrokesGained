import { createHash } from 'node:crypto'
import {
  CosmosClient,
  type Container,
  type ItemDefinition,
} from '@azure/cosmos'
import { readCourseCatalog } from './courseCatalogStore.js'
import { ValidationError } from './stateModel.js'
import {
  CourseConflictError,
  CourseNotFoundError,
  addCourseAggregateTee,
  archiveCourseAggregateTee,
  assertNoIdentityCollisions,
  convertLegacyCatalog,
  createCourseAggregate,
  deterministicCatalogId,
  flattenCourseAggregate,
  normalizedCourseKey,
  updateCourseAggregateTee,
  type CreatePublishedCoursePayload,
  type AddPublishedTeePayload,
  type PublishedCourseTemplate,
  type StoredCourseAggregate,
  type UpdatePublishedTeePayload,
} from './courseCatalogV2Model.js'

let container: Container | null = null
let migrationPromise: Promise<void> | null = null
const MIGRATION_ID = 'migration-legacy-catalog-v1'

interface CourseIdentityClaim {
  id: string
  courseId: string
  documentType: 'identity'
  identity: string
  ownerCourseId: string
  ownerTeeId: string
  status: 'pending' | 'committed'
  _etag?: string
}

interface MigrationMarker {
  id: typeof MIGRATION_ID
  courseId: typeof MIGRATION_ID
  documentType: 'migration'
  completedAt: string
  legacyRevision: number
  _etag?: string
}

export async function listPublishedCourses(): Promise<
  StoredCourseAggregate[]
> {
  await ensureV2Catalog()
  return listAggregates()
}

export async function findPublishedTemplate(
  courseId: string,
  teeId: string,
): Promise<PublishedCourseTemplate | null> {
  await ensureV2Catalog()
  const course = await readCourseAggregateRaw(courseId)
  return (
    course
      ? flattenCourseAggregate(course).find((tee) => tee.teeId === teeId)
      : undefined
  ) ?? null
}

export async function findPublishedTemplateByIdentity(
  identity: string,
): Promise<PublishedCourseTemplate | null> {
  const matches = (await listPublishedCourses())
    .flatMap(flattenCourseAggregate)
    .filter(
      (course) =>
        course.key === identity || course.aliases?.includes(identity) === true,
    )
  if (matches.length > 1) {
    throw new CourseConflictError(
      'The legacy shared-course identity is ambiguous.',
    )
  }
  return matches[0] ?? null
}

export async function createPublishedCourse(
  payload: CreatePublishedCoursePayload,
  ids?: { courseId?: string; teeId?: string },
): Promise<StoredCourseAggregate> {
  await ensureV2Catalog()
  const identity = normalizedCourseKey(payload.name, payload.teeName)
  const candidate = createCourseAggregate(payload, undefined, {
    courseId:
      ids?.courseId ??
      deterministicCatalogId('course', payload.name),
    teeId: ids?.teeId ?? deterministicCatalogId('tee', identity),
  })
  const courses = await listAggregates()
  if (courses.length >= 1_000) {
    throw new ValidationError('The shared catalog has too many courses.')
  }
  assertNoIdentityCollisions(candidate, courses)
  await reserveIdentityClaims(candidate)

  try {
    const response =
      await getV2Container().items.create<StoredCourseAggregate>(candidate)
    await finalizeIdentityClaims(candidate)
    return response.resource ?? candidate
  } catch (error) {
    if (getStatusCode(error) === 409) {
      const existing = await readCourseAggregate(candidate.courseId)
      if (existing && samePublishedContent(existing, candidate)) return existing
      throw new CourseConflictError(
        'The shared course was created elsewhere.',
        existing,
      )
    }
    throw error
  }
}

export async function updatePublishedTee(
  courseId: string,
  teeId: string,
  payload: UpdatePublishedTeePayload,
): Promise<StoredCourseAggregate> {
  await ensureV2Catalog()
  const current = await readCourseAggregateRaw(courseId)
  if (!current) {
    throw new CourseNotFoundError('The shared course no longer exists.')
  }
  const next = updateCourseAggregateTee(current, teeId, payload)
  assertNoIdentityCollisions(next, await listAggregates())
  await reserveIdentityClaims(next)
  const updated = await replaceCourse(current, next)
  await finalizeIdentityClaims(next)
  return updated
}

export async function addPublishedTee(
  courseId: string,
  payload: AddPublishedTeePayload,
): Promise<StoredCourseAggregate> {
  await ensureV2Catalog()
  const current = await readCourseAggregateRaw(courseId)
  if (!current) {
    throw new CourseNotFoundError('The shared course no longer exists.')
  }
  const next = addCourseAggregateTee(
    current,
    payload,
    undefined,
    deterministicCatalogId(
      'tee',
      `${courseId}:${normalizedCourseKey(payload.name, payload.teeName)}`,
    ),
  )
  assertNoIdentityCollisions(next, await listAggregates())
  await reserveIdentityClaims(next)
  const updated = await replaceCourse(current, next)
  await finalizeIdentityClaims(next)
  return updated
}

export async function deletePublishedTee(
  courseId: string,
  teeId: string,
  revision: number,
): Promise<StoredCourseAggregate> {
  await ensureV2Catalog()
  const current = await readCourseAggregateRaw(courseId)
  if (!current) {
    throw new CourseNotFoundError('The shared course no longer exists.')
  }
  return replaceCourse(
    current,
    archiveCourseAggregateTee(current, teeId, revision),
  )
}

export async function readCourseAggregate(
  courseId: string,
): Promise<StoredCourseAggregate | null> {
  await ensureV2Catalog()
  return readCourseAggregateRaw(courseId)
}

async function readCourseAggregateRaw(
  courseId: string,
): Promise<StoredCourseAggregate | null> {
  try {
    const response = await getV2Container()
      .item(courseId, courseId)
      .read<StoredCourseAggregate>()
    return response.resource ?? null
  } catch (error) {
    if (getStatusCode(error) === 404) return null
    throw error
  }
}

async function ensureV2Catalog(): Promise<void> {
  migrationPromise ??= migrateLegacyCatalogIfNeeded()
  try {
    await migrationPromise
  } finally {
    migrationPromise = null
  }
}

async function migrateLegacyCatalogIfNeeded(): Promise<void> {
  const marker = await readDocument<MigrationMarker>(MIGRATION_ID)
  const legacy = await readCourseCatalog()
  const legacyRevision = legacy?.revision ?? 0
  if (marker?.legacyRevision === legacyRevision) return

  if (legacy?.courses.length) {
    for (const aggregate of convertLegacyCatalog(legacy)) {
      await reserveIdentityClaims(aggregate)
      const existing = await readCourseAggregateRaw(aggregate.courseId)
      if (
        existing &&
        existing.legacyCatalogRevision !== undefined &&
        existing.revision === 1 &&
        existing.legacyCatalogRevision < legacy.revision
      ) {
        await replaceCourse(existing, {
          ...aggregate,
          createdAt: existing.createdAt,
        })
        await finalizeIdentityClaims(aggregate)
        continue
      }
      try {
        await getV2Container().items.create(aggregate)
        await finalizeIdentityClaims(aggregate)
      } catch (error) {
        if (getStatusCode(error) !== 409) throw error
        const existing = await readCourseAggregateRaw(aggregate.courseId)
        if (!existing || !samePublishedContent(existing, aggregate)) {
          throw new CourseConflictError(
            'A migrated shared course differs from the legacy catalog.',
            existing,
          )
        }
        await finalizeIdentityClaims(aggregate)
      }
    }
  }

  const nextMarker: MigrationMarker = {
    id: MIGRATION_ID,
    courseId: MIGRATION_ID,
    documentType: 'migration',
    completedAt: new Date().toISOString(),
    legacyRevision,
  }
  if (marker) {
    const { _etag: _ignored, ...persisted } = nextMarker
    try {
      await getV2Container()
        .item(MIGRATION_ID, MIGRATION_ID)
        .replace(persisted, {
          accessCondition: marker._etag
            ? { type: 'IfMatch', condition: marker._etag }
            : undefined,
        })
    } catch (error) {
      if (getStatusCode(error) !== 412) throw error
    }
  } else {
    try {
      await getV2Container().items.create(nextMarker)
    } catch (error) {
      if (getStatusCode(error) !== 409) throw error
    }
  }
}

async function listAggregates(): Promise<StoredCourseAggregate[]> {
  const response = await getV2Container().items
    .query<StoredCourseAggregate>(
      'SELECT * FROM c WHERE c.documentType = "course"',
    )
    .fetchAll()
  return response.resources
}

async function reserveIdentityClaims(
  aggregate: StoredCourseAggregate,
): Promise<void> {
  for (const tee of aggregate.tees.filter((item) => item.status === 'active')) {
    for (const identity of [tee.key, ...(tee.aliases ?? [])]) {
      const claimId = identityClaimId(identity)
      const claim: CourseIdentityClaim = {
        id: claimId,
        courseId: claimId,
        documentType: 'identity',
        identity,
        ownerCourseId: aggregate.courseId,
        ownerTeeId: tee.teeId,
        status: 'pending',
      }
      try {
        await getV2Container().items.create(claim)
      } catch (error) {
        if (getStatusCode(error) !== 409) throw error
        const existing = await readDocument<CourseIdentityClaim>(claimId)
        if (
          existing?.documentType === 'identity' &&
          existing.identity === identity &&
          existing.ownerCourseId === aggregate.courseId &&
          existing.ownerTeeId === tee.teeId
        ) {
          continue
        }
        if (!existing || existing.documentType !== 'identity') {
          throw new CourseConflictError(
            'Another shared course already uses this course and tee identity.',
          )
        }
        throw new CourseConflictError(
          existing.status === 'committed'
            ? 'Another shared course already uses this course and tee identity.'
            : 'Another shared course is claiming this course and tee identity.',
        )
      }

    }
  }
}

async function finalizeIdentityClaims(
  aggregate: StoredCourseAggregate,
): Promise<void> {
  for (const tee of aggregate.tees.filter((item) => item.status === 'active')) {
    for (const identity of [tee.key, ...(tee.aliases ?? [])]) {
      const claimId = identityClaimId(identity)
      const existing = await readDocument<CourseIdentityClaim>(claimId)
      if (
        !existing ||
        existing.documentType !== 'identity' ||
        existing.ownerCourseId !== aggregate.courseId ||
        existing.ownerTeeId !== tee.teeId
      ) {
        throw new CourseConflictError(
          'The shared course identity reservation was lost.',
        )
      }
      if (existing.status === 'committed') continue
      const { _etag, ...persisted } = existing
      try {
        await getV2Container()
          .item(claimId, claimId)
          .replace(
            {
              ...persisted,
              status: 'committed',
            } satisfies CourseIdentityClaim,
            {
              accessCondition: _etag
                ? { type: 'IfMatch', condition: _etag }
                : undefined,
            },
          )
      } catch (error) {
        if (getStatusCode(error) !== 412) throw error
        const current = await readDocument<CourseIdentityClaim>(claimId)
        if (
          current?.status === 'committed' &&
          current.ownerCourseId === aggregate.courseId &&
          current.ownerTeeId === tee.teeId
        ) {
          continue
        }
        throw new CourseConflictError(
          'The shared course identity reservation changed elsewhere.',
        )
      }
    }
  }
}

async function readDocument<T extends ItemDefinition>(
  id: string,
): Promise<T | null> {
  try {
    const response = await getV2Container().item(id, id).read<T>()
    return response.resource ?? null
  } catch (error) {
    if (getStatusCode(error) === 404) return null
    throw error
  }
}

function identityClaimId(identity: string): string {
  return `identity-${createHash('sha256').update(identity).digest('hex')}`
}

async function replaceCourse(
  current: StoredCourseAggregate,
  next: StoredCourseAggregate,
): Promise<StoredCourseAggregate> {
  try {
    const response = await getV2Container()
      .item(current.courseId, current.courseId)
      .replace<StoredCourseAggregate>(next, {
        accessCondition: current._etag
          ? { type: 'IfMatch', condition: current._etag }
          : undefined,
      })
    return response.resource ?? next
  } catch (error) {
    if (getStatusCode(error) === 409 || getStatusCode(error) === 412) {
      throw new CourseConflictError(
        'The shared course changed elsewhere.',
        await readCourseAggregateRaw(current.courseId),
      )
    }
    throw error
  }
}

function samePublishedContent(
  left: StoredCourseAggregate,
  right: StoredCourseAggregate,
): boolean {
  return JSON.stringify(flattenCourseAggregate(left)) ===
    JSON.stringify(flattenCourseAggregate(right))
}

function getV2Container(): Container {
  if (container) return container

  const connectionString = process.env.COSMOS_CONNECTION_STRING
  const databaseName = process.env.COSMOS_DATABASE_NAME
  const containerName =
    process.env.COSMOS_COURSE_CATALOG_V2_CONTAINER_NAME
  if (!connectionString || !databaseName || !containerName) {
    throw new Error('V2 shared course catalog settings are incomplete.')
  }
  container = new CosmosClient(connectionString)
    .database(databaseName)
    .container(containerName)
  return container
}

function getStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  if ('code' in error && typeof error.code === 'number') return error.code
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode
  }
  return undefined
}
