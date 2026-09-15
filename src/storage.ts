import type { CourseTemplate, Round } from './domain'

const STORAGE_KEY = 'golf-strokes-gained-rounds-v1'
const COURSES_STORAGE_KEY = 'golf-strokes-gained-courses-v1'
const DELETED_COURSES_STORAGE_KEY = 'golf-strokes-gained-deleted-courses-v1'
const CLOUD_METADATA_STORAGE_KEY = 'golf-strokes-gained-cloud-metadata-v1'

export interface CloudMetadata {
  ownerId: string
  revision: number
  updatedAt: string | null
  fingerprint: string
}

export function loadRounds(): Round[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Round[]) : []
  } catch {
    return []
  }
}

export function saveRounds(rounds: Round[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rounds))
}

export function loadCourses(): CourseTemplate[] {
  try {
    const raw = window.localStorage.getItem(COURSES_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CourseTemplate[]) : []
  } catch {
    return []
  }
}

export function saveCourses(courses: CourseTemplate[]): void {
  window.localStorage.setItem(COURSES_STORAGE_KEY, JSON.stringify(courses))
}

export function loadDeletedCourseKeys(): string[] {
  try {
    const raw = window.localStorage.getItem(DELETED_COURSES_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function saveDeletedCourseKeys(keys: string[]): void {
  window.localStorage.setItem(DELETED_COURSES_STORAGE_KEY, JSON.stringify(keys))
}

export function loadCloudMetadata(): CloudMetadata | null {
  try {
    const raw = window.localStorage.getItem(CLOUD_METADATA_STORAGE_KEY)
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

export function saveCloudMetadata(metadata: CloudMetadata): void {
  window.localStorage.setItem(CLOUD_METADATA_STORAGE_KEY, JSON.stringify(metadata))
}
