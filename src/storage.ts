import { CLUB_OPTIONS, type CourseTemplate, type Round } from './domain'
import type { LocalState } from './cloudState'

const STORAGE_KEY = 'golf-strokes-gained-rounds-v1'
const COURSES_STORAGE_KEY = 'golf-strokes-gained-courses-v1'
const DELETED_COURSES_STORAGE_KEY = 'golf-strokes-gained-deleted-courses-v1'
const CLUBS_STORAGE_KEY = 'golf-strokes-gained-clubs-v1'
const CLOUD_METADATA_STORAGE_KEY = 'golf-strokes-gained-cloud-metadata-v1'
const SHARED_COURSES_STORAGE_KEY = 'golf-strokes-gained-shared-courses-v1'
const LAST_OWNER_STORAGE_KEY = 'golf-strokes-gained-last-owner-v1'

export interface CloudMetadata {
  ownerId: string
  revision: number
  updatedAt: string | null
  fingerprint: string
}

export function loadRounds(ownerId?: string | null): Round[] {
  try {
    const raw = window.localStorage.getItem(scopedKey(STORAGE_KEY, ownerId))
    return raw ? (JSON.parse(raw) as Round[]) : []
  } catch {
    return []
  }
}

export function saveRounds(rounds: Round[], ownerId?: string | null): void {
  window.localStorage.setItem(scopedKey(STORAGE_KEY, ownerId), JSON.stringify(rounds))
}

export function loadCourses(ownerId?: string | null): CourseTemplate[] {
  try {
    const raw = window.localStorage.getItem(scopedKey(COURSES_STORAGE_KEY, ownerId))
    return raw ? (JSON.parse(raw) as CourseTemplate[]) : []
  } catch {
    return []
  }
}

export function saveCourses(
  courses: CourseTemplate[],
  ownerId?: string | null,
): void {
  window.localStorage.setItem(
    scopedKey(COURSES_STORAGE_KEY, ownerId),
    JSON.stringify(courses),
  )
}

export function loadDeletedCourseKeys(ownerId?: string | null): string[] {
  try {
    const raw = window.localStorage.getItem(
      scopedKey(DELETED_COURSES_STORAGE_KEY, ownerId),
    )
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function saveDeletedCourseKeys(
  keys: string[],
  ownerId?: string | null,
): void {
  window.localStorage.setItem(
    scopedKey(DELETED_COURSES_STORAGE_KEY, ownerId),
    JSON.stringify(keys),
  )
}

export function loadClubs(ownerId?: string | null): string[] {
  try {
    const raw = window.localStorage.getItem(scopedKey(CLUBS_STORAGE_KEY, ownerId))
    if (!raw) return [...CLUB_OPTIONS]
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) &&
      parsed.every((club) => typeof club === 'string' && club.length > 0 && club.length <= 40)
      ? parsed
      : [...CLUB_OPTIONS]
  } catch {
    return [...CLUB_OPTIONS]
  }
}

export function saveClubs(clubs: string[], ownerId?: string | null): void {
  window.localStorage.setItem(scopedKey(CLUBS_STORAGE_KEY, ownerId), JSON.stringify(clubs))
}

export function loadCloudMetadata(ownerId?: string | null): CloudMetadata | null {
  try {
    const raw = window.localStorage.getItem(
      scopedKey(CLOUD_METADATA_STORAGE_KEY, ownerId),
    )
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CloudMetadata>
    if (
      typeof parsed.ownerId !== 'string' ||
      !Number.isSafeInteger(parsed.revision) ||
      (parsed.revision ?? -1) < 0 ||
      (typeof parsed.updatedAt !== 'string' && parsed.updatedAt !== null) ||
      (parsed.fingerprint !== undefined && typeof parsed.fingerprint !== 'string')
    ) {
      return null
    }
    return { ...(parsed as CloudMetadata), fingerprint: parsed.fingerprint ?? '' }
  } catch {
    return null
  }
}

export function saveCloudMetadata(
  metadata: CloudMetadata,
  ownerId?: string | null,
): void {
  window.localStorage.setItem(
    scopedKey(CLOUD_METADATA_STORAGE_KEY, ownerId),
    JSON.stringify(metadata),
  )
}

export function hasScopedLocalState(ownerId: string): boolean {
  return [
    STORAGE_KEY,
    COURSES_STORAGE_KEY,
    DELETED_COURSES_STORAGE_KEY,
    CLUBS_STORAGE_KEY,
  ].some((key) => window.localStorage.getItem(scopedKey(key, ownerId)) !== null)
}

export function loadScopedLocalState(ownerId: string): LocalState {
  return {
    rounds: loadRounds(ownerId),
    courses: loadCourses(ownerId),
    deletedCourseKeys: loadDeletedCourseKeys(ownerId),
    clubs: loadClubs(ownerId),
  }
}

export function loadSharedCourses(ownerId: string): CourseTemplate[] {
  try {
    const raw = window.localStorage.getItem(
      scopedKey(SHARED_COURSES_STORAGE_KEY, ownerId),
    )
    return raw ? (JSON.parse(raw) as CourseTemplate[]) : []
  } catch {
    return []
  }
}

export function saveSharedCourses(
  ownerId: string,
  courses: CourseTemplate[],
): void {
  window.localStorage.setItem(
    scopedKey(SHARED_COURSES_STORAGE_KEY, ownerId),
    JSON.stringify(courses),
  )
}

export function loadLastOwnerId(): string | null {
  const value = window.localStorage.getItem(LAST_OWNER_STORAGE_KEY)
  return value?.trim() || null
}

export function saveLastOwnerId(ownerId: string): void {
  window.localStorage.setItem(LAST_OWNER_STORAGE_KEY, ownerId)
}

export function clearLastOwnerId(): void {
  window.localStorage.removeItem(LAST_OWNER_STORAGE_KEY)
}

function scopedKey(baseKey: string, ownerId?: string | null): string {
  return ownerId ? `${baseKey}:user:${encodeURIComponent(ownerId)}` : baseKey
}
