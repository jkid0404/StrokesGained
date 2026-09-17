import type { CourseTemplate } from './domain'
import { CloudRequestError } from './cloudClient'

export interface SharedCourseCatalog {
  courses: CourseTemplate[]
  revision: number
  updatedAt: string | null
  exists: boolean
}

export class SharedCourseConflictError extends Error {
  readonly current: SharedCourseCatalog

  constructor(current: SharedCourseCatalog) {
    super('The shared course catalog changed elsewhere.')
    this.current = current
  }
}

export async function fetchSharedCourses(
  signal?: AbortSignal,
): Promise<SharedCourseCatalog> {
  const response = await fetch('/api/courses', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  })
  return parseCatalogResponse(response)
}

export async function putSharedCourses(
  courses: CourseTemplate[],
  revision: number,
  signal?: AbortSignal,
): Promise<SharedCourseCatalog> {
  const response = await fetch('/api/courses', {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ courses, revision }),
    signal,
  })
  const catalog = await parseCatalogResponse(response, true)
  return catalog
}

export function mergeSharedCourses(
  privateCourses: CourseTemplate[],
  sharedCourses: CourseTemplate[],
): CourseTemplate[] {
  const merged = new Map(privateCourses.map((course) => [course.key, course]))
  for (const course of sharedCourses) merged.set(course.key, course)
  return [...merged.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.teeName.localeCompare(b.teeName),
  )
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
    if (allowConflict && response.status === 409 && catalog) {
      throw new SharedCourseConflictError(catalog)
    }
    throw new CloudRequestError(
      body?.error ?? `Course catalog request failed with status ${response.status}.`,
      response.status,
    )
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
