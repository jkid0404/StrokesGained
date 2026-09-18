import { useCallback, useEffect, useRef, useState } from 'react'
import type { CourseTemplate } from './domain'
import {
  createSharedCourse,
  deleteSharedCourse,
  fetchSharedCourses,
  SharedCourseConflictError,
  updateSharedCourse,
  type SharedCourseCatalog,
} from './sharedCourses'
import {
  loadSharedCourses,
  saveSharedCourses,
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
  const [revision, setRevision] = useState(0)
  const [conflictCatalog, setConflictCatalog] =
    useState<SharedCourseCatalog | null>(null)
  const coursesRef = useRef(courses)
  const onChangeRef = useRef(onChange)
  const initializedOwnerRef = useRef<string | null>(null)

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

  const applyCatalog = useCallback(
    (catalog: SharedCourseCatalog, nextMessage: string) => {
      if (!ownerId) return
      initializedOwnerRef.current = ownerId
      coursesRef.current = catalog.courses
      onChangeRef.current(catalog.courses)
      saveSharedCourses(ownerId, catalog.courses)
      setRevision(catalog.revision)
      setConflictCatalog(null)
      setStatus('saved')
      setMessage(nextMessage)
    },
    [ownerId],
  )

  useEffect(() => {
    if (!enabled || !ownerId) return
    const controller = new AbortController()
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setStatus('loading')
        setMessage('Loading shared courses…')
      }
    })
    const cachedCourses =
      coursesRef.current.length > 0
        ? coursesRef.current
        : loadSharedCourses(ownerId)
    if (
      cachedCourses.length > 0 &&
      courseFingerprint(cachedCourses) !== courseFingerprint(coursesRef.current)
    ) {
      initializedOwnerRef.current = ownerId
      coursesRef.current = cachedCourses
      onChangeRef.current(cachedCourses)
    }

    fetchSharedCourses(controller.signal)
      .then((catalog) => {
        if (controller.signal.aborted) return
        applyCatalog(
          catalog,
          catalog.exists ? 'Shared courses loaded' : 'No shared courses yet',
        )
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
  }, [applyCatalog, enabled, ownerId, retryToken])

  const runMutation = useCallback(
    async (
      operation: () => Promise<SharedCourseCatalog>,
      successMessage: string,
    ): Promise<CourseTemplate[]> => {
      if (!isAdmin || !ownerId) {
        throw new Error('Administrator access is required.')
      }
      setStatus('saving')
      setMessage('Saving shared course…')
      try {
        const catalog = await operation()
        applyCatalog(catalog, successMessage)
        return catalog.courses
      } catch (error) {
        if (error instanceof SharedCourseConflictError) {
          setRevision(error.current.revision)
          setConflictCatalog(error.current)
          setStatus('conflict')
          setMessage(error.message)
        } else {
          setStatus(navigator.onLine ? 'error' : 'offline')
          setMessage(
            navigator.onLine
              ? error instanceof Error
                ? error.message
                : 'Shared course change was not saved'
              : 'Offline · shared course change was not saved',
          )
        }
        throw error
      }
    },
    [applyCatalog, isAdmin, ownerId],
  )

  const createCourse = useCallback(
    (course: CourseTemplate, existingCourse?: CourseTemplate) =>
      runMutation(
        () => createSharedCourse(course, existingCourse),
        'Shared course created',
      ),
    [runMutation],
  )

  const updateCourse = useCallback(
    (course: CourseTemplate) =>
      runMutation(
        () => updateSharedCourse(course),
        'Shared course updated',
      ),
    [runMutation],
  )

  const deleteCourse = useCallback(
    (course: CourseTemplate) =>
      runMutation(
        () => deleteSharedCourse(course),
        'Shared course deleted',
      ),
    [runMutation],
  )

  const reloadServerCatalog = useCallback(() => {
    if (!conflictCatalog) {
      setRetryToken((value) => value + 1)
      return
    }
    applyCatalog(conflictCatalog, 'Shared courses reloaded')
  }, [applyCatalog, conflictCatalog])

  const refreshCatalog = useCallback(() => {
    setRetryToken((value) => value + 1)
  }, [])

  return {
    status,
    message,
    revision,
    createCourse,
    updateCourse,
    deleteCourse,
    reloadServerCatalog,
    refreshCatalog,
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
