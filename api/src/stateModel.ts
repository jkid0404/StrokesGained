export interface StatePayload {
  rounds: unknown[]
  courses: unknown[]
  deletedCourseKeys: string[]
  revision: number
}

export interface StoredState extends StatePayload {
  id: string
  ownerId: string
  updatedAt: string
  _etag?: string
}

export interface StateResponse extends StatePayload {
  updatedAt: string | null
  exists: boolean
}

const MAX_BODY_BYTES = 900_000
const MAX_ROUNDS = 5_000
const MAX_COURSES = 1_000
const MAX_DELETED_KEYS = 5_000

export function validateStatePayload(value: unknown): StatePayload {
  if (!isRecord(value)) throw new ValidationError('Request body must be an object.')

  const allowedKeys = new Set(['rounds', 'courses', 'deletedCourseKeys', 'revision'])
  const unexpectedKey = Object.keys(value).find((key) => !allowedKeys.has(key))
  if (unexpectedKey) {
    throw new ValidationError(`Unexpected property: ${unexpectedKey}.`)
  }

  const { rounds, courses, deletedCourseKeys, revision } = value
  if (!Array.isArray(rounds) || !rounds.every(isRound)) {
    throw new ValidationError('rounds contains an invalid round.')
  }
  if (!Array.isArray(courses) || !courses.every(isCourse)) {
    throw new ValidationError('courses contains an invalid course.')
  }
  if (
    !Array.isArray(deletedCourseKeys) ||
    !deletedCourseKeys.every(
      (key) => typeof key === 'string' && key.length > 0 && key.length <= 500,
    )
  ) {
    throw new ValidationError('deletedCourseKeys must be an array of non-empty strings.')
  }
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) {
    throw new ValidationError('revision must be a non-negative integer.')
  }
  if (rounds.length > MAX_ROUNDS) throw new ValidationError('Too many rounds.')
  if (courses.length > MAX_COURSES) throw new ValidationError('Too many courses.')
  if (deletedCourseKeys.length > MAX_DELETED_KEYS) {
    throw new ValidationError('Too many deleted course keys.')
  }

  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new ValidationError('Request body must contain JSON-serializable data.')
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) {
    throw new PayloadTooLargeError('State exceeds the 900 KB limit.')
  }

  return {
    rounds,
    courses,
    deletedCourseKeys,
    revision: revision as number,
  }
}

export function toStateResponse(
  state: StoredState | null,
  exists: boolean,
): StateResponse {
  if (!state) {
    return {
      rounds: [],
      courses: [],
      deletedCourseKeys: [],
      revision: 0,
      updatedAt: null,
      exists: false,
    }
  }

  return {
    rounds: state.rounds,
    courses: state.courses,
    deletedCourseKeys: state.deletedCourseKeys,
    revision: state.revision,
    updatedAt: state.updatedAt,
    exists,
  }
}

export class ValidationError extends Error {}
export class PayloadTooLargeError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRound(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    isShortString(value.id, 200) &&
    isShortString(value.courseName, 500) &&
    (value.teeName === undefined || isShortString(value.teeName, 500)) &&
    isShortString(value.playedOn, 100) &&
    isShortString(value.createdAt, 100) &&
    (value.status === 'draft' || value.status === 'complete') &&
    isShortString(value.benchmarkVersion, 200) &&
    Array.isArray(value.holes) &&
    value.holes.length <= 18 &&
    value.holes.every(isHole)
  )
}

function isHole(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    isIntegerInRange(value.number, 1, 18) &&
    isNumberInRange(value.par, 0, 10) &&
    isNumberInRange(value.yardage, 0, 2_000) &&
    Array.isArray(value.shots) &&
    value.shots.length <= 100 &&
    value.shots.every(isShot)
  )
}

function isShot(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    isShortString(value.id, 200) &&
    isPosition(value.start) &&
    isPosition(value.finish) &&
    isIntegerInRange(value.penaltyStrokes, 0, 20) &&
    (value.club === undefined || isShortString(value.club, 40)) &&
    (value.note === undefined || isShortString(value.note, 300))
  )
}

function isPosition(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.lie === 'string' &&
    ['tee', 'fairway', 'rough', 'sand', 'recovery', 'green', 'holed'].includes(
      value.lie,
    ) &&
    isNumberInRange(value.distance, 0, 10_000) &&
    (value.unit === 'yards' || value.unit === 'feet')
  )
}

function isCourse(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.holes)) return false
  const holes = Object.entries(value.holes)
  return (
    isShortString(value.key, 1_000) &&
    isShortString(value.name, 500) &&
    isShortString(value.teeName, 500) &&
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

function isShortString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && isNumberInRange(value, min, max)
}
