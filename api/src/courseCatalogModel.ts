import {
  PayloadTooLargeError,
  ValidationError,
} from './stateModel.js'

export interface CourseCatalogPayload {
  courses: unknown[]
  revision: number
}

export interface StoredCourseCatalog extends CourseCatalogPayload {
  id: 'catalog'
  updatedAt: string
  _etag?: string
}

export interface CourseCatalogResponse extends CourseCatalogPayload {
  updatedAt: string | null
  exists: boolean
}

const MAX_BODY_BYTES = 900_000
const MAX_COURSES = 1_000

export function validateCourseCatalogPayload(
  value: unknown,
): CourseCatalogPayload {
  if (!isRecord(value)) {
    throw new ValidationError('Request body must be an object.')
  }
  const unexpectedKey = Object.keys(value).find(
    (key) => key !== 'courses' && key !== 'revision',
  )
  if (unexpectedKey) {
    throw new ValidationError(`Unexpected property: ${unexpectedKey}.`)
  }
  if (!Array.isArray(value.courses) || !value.courses.every(isCourse)) {
    throw new ValidationError('courses contains an invalid course.')
  }
  if (value.courses.length > MAX_COURSES) {
    throw new ValidationError('Too many courses.')
  }
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
    throw new ValidationError('revision must be a non-negative integer.')
  }

  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) {
    throw new PayloadTooLargeError('Course catalog exceeds the 900 KB limit.')
  }

  return {
    courses: value.courses,
    revision: value.revision as number,
  }
}

export function toCourseCatalogResponse(
  catalog: StoredCourseCatalog | null,
): CourseCatalogResponse {
  return catalog
    ? {
        courses: catalog.courses,
        revision: catalog.revision,
        updatedAt: catalog.updatedAt,
        exists: true,
      }
    : {
        courses: [],
        revision: 0,
        updatedAt: null,
        exists: false,
      }
}

function isCourse(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.holes)) return false
  const holes = Object.entries(value.holes)
  return (
    isShortString(value.key, 1_000) &&
    isShortString(value.name, 500) &&
    isShortString(value.teeName, 500) &&
    (value.aliases === undefined ||
      (Array.isArray(value.aliases) &&
        value.aliases.length <= 100 &&
        value.aliases.every((alias) => isShortString(alias, 1_000)))) &&
    holes.length <= 18 &&
    holes.every(([number, hole]) => {
      if (!/^(?:[1-9]|1[0-8])$/.test(number) || !isRecord(hole)) return false
      return (
        isNumberInRange(hole.par, 0, 10) &&
        isNumberInRange(hole.yardage, 0, 2_000)
      )
    })
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isShortString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}
