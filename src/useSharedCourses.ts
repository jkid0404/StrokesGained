import { useCallback, useEffect, useRef, useState } from 'react'
import type { CourseTemplate } from './domain'
import {
  fetchSharedCourses,
  putSharedCourses,
  SharedCourseConflictError,
} from './sharedCourses'
import {
  loadSharedCourses,
  loadSharedCourseMetadata,
  saveSharedCourses,
  saveSharedCourseMetadata,
} from './storage'

export type SharedCourseStatus =
  | 'idle'
  | 'loading'
  | 'saved'
  | 'saving'
  | 'offline'
  | 'conflict'
  | 'error'

export function useSharedCourses({
  courses,
  enabled,
  isAdmin,
  ownerId,
  onChange,
}: {
  courses: CourseTemplate[]
  enabled: boolean
  isAdmin: boolean
  ownerId: string | null
  onChange: (courses: CourseTemplate[]) => void
}) {
  const [status, setStatus] = useState<SharedCourseStatus>('idle')
  const [message, setMessage] = useState('Shared courses unavailable')
  const [retryToken, setRetryToken] = useState(0)
  const [conflictCatalog, setConflictCatalog] = useState<{
    courses: CourseTemplate[]
    revision: number
  } | null>(null)
  const coursesRef = useRef(courses)
  const onChangeRef = useRef(onChange)
  const revisionRef = useRef(0)
  const initializedOwnerRef = useRef<string | null>(null)
  const lastSyncedRef = useRef('')

  useEffect(() => {
    coursesRef.current = courses
    onChangeRef.current = onChange
  }, [courses, onChange])

  useEffect(() => {
    if (canPersistSharedCourseCache(ownerId, initializedOwnerRef.current)) {
      saveSharedCourses(ownerId, courses)
    }
  }, [courses, ownerId])

  useEffect(() => {
    const handleOnline = () => setRetryToken((value) => value + 1)
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [])

  useEffect(() => {
    if (!enabled || !ownerId) return
    const controller = new AbortController()
    const cachedCourses =
      coursesRef.current.length > 0
        ? coursesRef.current
        : loadSharedCourses(ownerId)
    if (
      cachedCourses.length > 0 &&
      courseFingerprint(cachedCourses) !== courseFingerprint(coursesRef.current)
    ) {
      coursesRef.current = cachedCourses
      onChangeRef.current(cachedCourses)
    }

    fetchSharedCourses(controller.signal)
      .then(async (catalog) => {
        if (controller.signal.aborted) return
        revisionRef.current = catalog.revision
        initializedOwnerRef.current = ownerId
        const localFingerprint = courseFingerprint(cachedCourses)
        const metadata = loadSharedCourseMetadata(ownerId)

        if (
          isAdmin &&
          metadata &&
          localFingerprint !== metadata.fingerprint
        ) {
          if (metadata.revision !== catalog.revision) {
            revisionRef.current = catalog.revision
            setConflictCatalog({
              courses: catalog.courses,
              revision: catalog.revision,
            })
            setStatus('conflict')
            setMessage('Shared courses changed elsewhere')
            return
          }
          const saved = await putSharedCourses(
            cachedCourses,
            catalog.revision,
            controller.signal,
          )
          revisionRef.current = saved.revision
          lastSyncedRef.current = courseFingerprint(saved.courses)
          persistMetadata(ownerId, saved.revision, lastSyncedRef.current)
          setStatus('saved')
          setMessage('Pending shared courses saved')
          setConflictCatalog(null)
          return
        }

        lastSyncedRef.current = courseFingerprint(catalog.courses)
        persistMetadata(ownerId, catalog.revision, lastSyncedRef.current)
        if (lastSyncedRef.current !== localFingerprint) {
          onChangeRef.current(catalog.courses)
        }
        setStatus('saved')
        setMessage(
          catalog.exists
            ? 'Shared courses loaded'
            : 'No shared courses yet',
        )
        setConflictCatalog(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setStatus(navigator.onLine ? 'error' : 'offline')
        setMessage(
          navigator.onLine
            ? error instanceof Error
              ? error.message
              : 'Unable to load shared courses'
            : 'Offline · using cached courses',
        )
      })

    return () => controller.abort()
  }, [enabled, isAdmin, ownerId, retryToken])

  useEffect(() => {
    if (
      !enabled ||
      !isAdmin ||
      !ownerId ||
      initializedOwnerRef.current !== ownerId ||
      conflictCatalog
    ) {
      return
    }
    const fingerprint = courseFingerprint(courses)
    if (fingerprint === lastSyncedRef.current) return

    const timer = window.setTimeout(async () => {
      const coursesToSave = coursesRef.current
      if (courseFingerprint(coursesToSave) === lastSyncedRef.current) return
      setStatus('saving')
      setMessage('Saving shared courses…')
      try {
        const saved = await putSharedCourses(
          coursesToSave,
          revisionRef.current,
        )
        revisionRef.current = saved.revision
        lastSyncedRef.current = courseFingerprint(saved.courses)
        persistMetadata(ownerId, saved.revision, lastSyncedRef.current)
        setStatus('saved')
        setMessage('Shared courses saved')
        setConflictCatalog(null)
      } catch (error) {
        if (error instanceof SharedCourseConflictError) {
          revisionRef.current = error.current.revision
          setConflictCatalog({
            courses: error.current.courses,
            revision: error.current.revision,
          })
          setStatus('conflict')
          setMessage('Shared courses changed elsewhere')
        } else {
          setStatus(navigator.onLine ? 'error' : 'offline')
          setMessage(
            navigator.onLine
              ? 'Shared course changes not saved'
              : 'Offline · shared changes pending',
          )
        }
      }
    }, 900)

    return () => window.clearTimeout(timer)
  }, [conflictCatalog, courses, enabled, isAdmin, ownerId, retryToken])

  const reloadServerCatalog = useCallback(() => {
    if (!conflictCatalog || !ownerId) return
    revisionRef.current = conflictCatalog.revision
    lastSyncedRef.current = courseFingerprint(conflictCatalog.courses)
    coursesRef.current = conflictCatalog.courses
    onChangeRef.current(conflictCatalog.courses)
    persistMetadata(
      ownerId,
      conflictCatalog.revision,
      lastSyncedRef.current,
    )
    setConflictCatalog(null)
    setStatus('saved')
    setMessage('Shared courses reloaded')
  }, [conflictCatalog, ownerId])

  return {
    status,
    message,
    reloadServerCatalog,
  }
}

function courseFingerprint(courses: CourseTemplate[]): string {
  return JSON.stringify(courses)
}

export function canPersistSharedCourseCache(
  ownerId: string | null,
  initializedOwnerId: string | null,
): ownerId is string {
  return ownerId !== null && initializedOwnerId === ownerId
}

function persistMetadata(
  ownerId: string,
  revision: number,
  fingerprint: string,
): void {
  saveSharedCourseMetadata(ownerId, { revision, fingerprint })
}
