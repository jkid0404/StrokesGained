import { CloudRequestError } from './cloudClient'
import type { CourseTemplate } from './domain'

export interface SharedCourseCatalog {
  courses: CourseTemplate[]
  revision: number
  updatedAt: string | null
  exists: boolean
}

export class SharedCourseConflictError extends Error {
  readonly current: SharedCourseCatalog

  constructor(message: string, current: SharedCourseCatalog) {
    super(message)
    this.current = current
  }
}

export async function fetchSharedCourses(
  signal?: AbortSignal,
): Promise<SharedCourseCatalog> {
  return requestCatalog('/api/courses', { signal })
}

export async function createSharedCourse(
  course: CourseTemplate,
  existingCourse?: CourseTemplate,
  signal?: AbortSignal,
): Promise<SharedCourseCatalog> {
  const path = existingCourse?.courseId
    ? `/api/courses/${encodeURIComponent(existingCourse.courseId)}/tees`
    : '/api/courses'
  return requestCatalog(path, {
    method: 'POST',
    body: JSON.stringify({
      name: course.name,
      teeName: course.teeName,
      holes: course.holes,
      ...(existingCourse?.revision
        ? { revision: existingCourse.revision }
        : {}),
    }),
    signal,
  })
}

export async function updateSharedCourse(
  course: CourseTemplate,
  signal?: AbortSignal,
): Promise<SharedCourseCatalog> {
  const identity = requirePublishedIdentity(course)
  return requestCatalog(
    `/api/courses/${encodeURIComponent(identity.courseId)}/tees/${encodeURIComponent(identity.teeId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        name: course.name,
        teeName: course.teeName,
        holes: course.holes,
        revision: identity.revision,
      }),
      signal,
    },
    true,
  )
}

export async function deleteSharedCourse(
  course: CourseTemplate,
  signal?: AbortSignal,
): Promise<SharedCourseCatalog> {
  const identity = requirePublishedIdentity(course)
  return requestCatalog(
    `/api/courses/${encodeURIComponent(identity.courseId)}/tees/${encodeURIComponent(identity.teeId)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({ revision: identity.revision }),
      signal,
    },
    true,
  )
}

export function mergeSharedCourses(
  privateCourses: CourseTemplate[],
  sharedCourses: CourseTemplate[],
): CourseTemplate[] {
  const merged = new Map(privateCourses.map((course) => [course.key, course]))
  for (const course of sharedCourses) {
    for (const identity of [course.key, ...(course.aliases ?? [])]) {
      merged.delete(identity)
    }
    merged.set(course.key, course)
  }
  return [...merged.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.teeName.localeCompare(b.teeName),
  )
}

async function requestCatalog(
  path: string,
  init: RequestInit,
  allowConflict = false,
): Promise<SharedCourseCatalog> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    cache: 'no-store',
  })
  return parseCatalogResponse(response, allowConflict)
}

async function parseCatalogResponse(
  response: Response,
  allowConflict = false,
): Promise<SharedCourseCatalog> {
  const body = (await response.json().catch(() => null)) as
    | (Partial<SharedCourseCatalog> & { error?: string })
    | null
  const catalog = normalizeCatalog(body)

  if (!response.ok) {
    const message =
      body?.error ??
      `Course catalog request failed with status ${response.status}.`
    if (allowConflict && response.status === 409 && catalog) {
      throw new SharedCourseConflictError(message, catalog)
    }
    throw new CloudRequestError(message, response.status)
  }
  if (!catalog) {
    throw new CloudRequestError(
      'The cloud returned an invalid course catalog response.',
      502,
    )
  }
  return catalog
}

function normalizeCatalog(value: unknown): SharedCourseCatalog | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<SharedCourseCatalog>
  if (
    !Array.isArray(candidate.courses) ||
    !candidate.courses.every(isPublishedCourse) ||
    !Number.isSafeInteger(candidate.revision) ||
    (typeof candidate.updatedAt !== 'string' && candidate.updatedAt !== null) ||
    typeof candidate.exists !== 'boolean'
  ) {
    return null
  }
  return {
    courses: candidate.courses,
    revision: candidate.revision as number,
    updatedAt: candidate.updatedAt,
    exists: candidate.exists,
  }
}

function isPublishedCourse(value: unknown): value is CourseTemplate {
  if (typeof value !== 'object' || value === null) return false
  const course = value as Partial<CourseTemplate>
  return (
    typeof course.key === 'string' &&
    typeof course.name === 'string' &&
    typeof course.teeName === 'string' &&
    typeof course.holes === 'object' &&
    course.holes !== null &&
    typeof course.courseId === 'string' &&
    typeof course.teeId === 'string' &&
    Number.isSafeInteger(course.revision)
  )
}

function requirePublishedIdentity(course: CourseTemplate): {
  courseId: string
  teeId: string
  revision: number
} {
  if (!course.courseId || !course.teeId || !course.revision) {
    throw new Error('The shared course is missing its immutable identity.')
  }
  return {
    courseId: course.courseId,
    teeId: course.teeId,
    revision: course.revision,
  }
}
