import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CloudConflictError,
  CloudRequestError,
  fetchAuthState,
  fetchCloudState,
  putCloudState,
  type ClientPrincipal,
} from './cloudClient'
import {
  decideBootstrap,
  stateFingerprint,
  type CloudState,
  type LocalState,
} from './cloudState'
import {
  loadCloudMetadata,
  saveCloudMetadata,
  type CloudMetadata,
} from './storage'

export type AuthMode = 'checking' | 'local' | 'signed-out' | 'signed-in' | 'denied'
export type SyncStatus =
  | 'local-only'
  | 'loading'
  | 'saving'
  | 'saved'
  | 'offline'
  | 'conflict'
  | 'error'

interface UseCloudSyncOptions {
  localState: LocalState
  applyState: (state: LocalState) => void
}

export interface CloudSyncController {
  authMode: AuthMode
  principal: ClientPrincipal | null
  syncStatus: SyncStatus
  syncMessage: string
  pendingChanges: number
  canUseApp: boolean
  reloadCloudData: () => void
}

export function useCloudSync({
  localState,
  applyState,
}: UseCloudSyncOptions): CloudSyncController {
  const [authMode, setAuthMode] = useState<AuthMode>('checking')
  const [principal, setPrincipal] = useState<ClientPrincipal | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('loading')
  const [syncMessage, setSyncMessage] = useState('Checking sign-in…')
  const [ready, setReady] = useState(false)
  const [retryToken, setRetryToken] = useState(0)
  const [conflictState, setConflictState] = useState<CloudState | null>(null)
  const [pendingChanges, setPendingChanges] = useState(0)
  const localFingerprint = stateFingerprint(localState)

  const localStateRef = useRef(localState)
  const applyStateRef = useRef(applyState)
  const revisionRef = useRef(0)
  const lastSyncedRef = useRef('')
  const initializedOwnerRef = useRef<string | null>(null)
  const saveInFlightRef = useRef(false)
  const observedFingerprintRef = useRef(localFingerprint)
  const pendingChangesRef = useRef(0)
  const retryAttemptRef = useRef(0)
  const retryTimerRef = useRef<number | null>(null)

  const updatePendingChanges = useCallback((count: number) => {
    pendingChangesRef.current = count
    setPendingChanges(count)
  }, [])

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }, [])

  const showSaved = useCallback((updatedAt: string | null) => {
    setSyncStatus('saved')
    setSyncMessage(`Saved to cloud · ${formatSyncTime(updatedAt)}`)
  }, [])

  useEffect(() => {
    localStateRef.current = localState
    applyStateRef.current = applyState
  }, [applyState, localState])

  useEffect(() => {
    if (localFingerprint === observedFingerprintRef.current) return
    observedFingerprintRef.current = localFingerprint
    if (
      initializedOwnerRef.current &&
      localFingerprint !== lastSyncedRef.current
    ) {
      updatePendingChanges(pendingChangesRef.current + 1)
    }
  }, [localFingerprint, updatePendingChanges])

  useEffect(() => () => clearRetry(), [clearRetry])

  useEffect(() => {
    const controller = new AbortController()
    fetchAuthState(controller.signal)
      .then((result) => {
        if (!result.available) {
          setAuthMode('local')
          setSyncStatus('local-only')
          setSyncMessage('Local only')
          setReady(true)
        } else if (!result.principal) {
          setAuthMode('signed-out')
          setSyncStatus('loading')
          setSyncMessage('Sign in to sync')
          setReady(false)
        } else {
          setPrincipal(result.principal)
          setAuthMode('signed-in')
          setSyncStatus('loading')
          setSyncMessage('Loading cloud data…')
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setAuthMode('local')
          setSyncStatus('local-only')
          setSyncMessage('Local only')
          setReady(true)
        }
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (authMode !== 'signed-in' || !principal) return

    const controller = new AbortController()
    const ownerId = principal.userId

    fetchCloudState(controller.signal)
      .then(async (cloudState) => {
        if (controller.signal.aborted) return
        const decision = decideBootstrap(localStateRef.current, cloudState)
        revisionRef.current = decision.revision
        initializedOwnerRef.current = ownerId

        if (decision.action === 'upload-local') {
          setSyncStatus('saving')
          setSyncMessage('Sync pending')
          const saved = await putCloudState(decision.state, 0, controller.signal)
          revisionRef.current = saved.revision
          lastSyncedRef.current = stateFingerprint(decision.state)
          persistMetadata(ownerId, saved)
          showSaved(saved.updatedAt)
        } else {
          lastSyncedRef.current = stateFingerprint(decision.state)
          applyStateRef.current(decision.state)
          persistMetadata(ownerId, cloudState)
          showSaved(cloudState.updatedAt)
        }

        observedFingerprintRef.current = lastSyncedRef.current
        updatePendingChanges(0)
        retryAttemptRef.current = 0
        clearRetry()
        setConflictState(null)
        setReady(true)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof CloudRequestError && error.status === 403) {
          initializedOwnerRef.current = null
          setAuthMode('denied')
          setSyncStatus('error')
          setSyncMessage('Account not allowed')
          setReady(false)
          return
        }
        if (error instanceof CloudConflictError) {
          setConflictState(error.current)
          setSyncStatus('conflict')
          setSyncMessage('Cloud data changed elsewhere')
          setReady(true)
          return
        }

        const cached = loadCloudMetadata()
        if (cached?.ownerId === ownerId) {
          revisionRef.current = cached.revision
          lastSyncedRef.current = cached.fingerprint
          if (stateFingerprint(localStateRef.current) !== cached.fingerprint) {
            updatePendingChanges(1)
          }
        } else {
          lastSyncedRef.current = ''
          if (hasLocalContent(localStateRef.current)) updatePendingChanges(1)
        }
        initializedOwnerRef.current = ownerId
        setSyncStatus(navigator.onLine ? 'error' : 'offline')
        setSyncMessage(
          navigator.onLine
            ? 'Sync pending'
            : offlineMessage(pendingChangesRef.current),
        )
        setReady(true)
      })

    return () => controller.abort()
  }, [authMode, clearRetry, principal, showSaved, updatePendingChanges])

  useEffect(() => {
    if (
      authMode !== 'signed-in' ||
      !principal ||
      initializedOwnerRef.current !== principal.userId ||
      conflictState
    ) {
      return
    }

    if (localFingerprint === lastSyncedRef.current) return

    const timer = window.setTimeout(async () => {
      if (saveInFlightRef.current) return

      const stateToSave = localStateRef.current
      const sentFingerprint = stateFingerprint(stateToSave)
      const sentChangeCount = Math.max(1, pendingChangesRef.current)
      let savedSuccessfully = false
      saveInFlightRef.current = true
      setSyncStatus('saving')
      setSyncMessage('Sync pending')

      try {
        const saved = await putCloudState(stateToSave, revisionRef.current)
        revisionRef.current = saved.revision
        lastSyncedRef.current = sentFingerprint
        persistMetadata(principal.userId, saved)
        savedSuccessfully = true
        retryAttemptRef.current = 0
        clearRetry()
        if (stateFingerprint(localStateRef.current) === sentFingerprint) {
          updatePendingChanges(0)
          showSaved(saved.updatedAt)
        } else {
          updatePendingChanges(Math.max(1, pendingChangesRef.current - sentChangeCount))
          setSyncStatus('saving')
          setSyncMessage('Sync pending')
        }
      } catch (error) {
        if (error instanceof CloudConflictError) {
          setConflictState(error.current)
          setSyncStatus('conflict')
          setSyncMessage('Cloud data changed elsewhere')
        } else {
          setSyncStatus(navigator.onLine ? 'error' : 'offline')
          setSyncMessage(
            navigator.onLine
              ? 'Sync pending'
              : offlineMessage(pendingChangesRef.current),
          )
          if (navigator.onLine) {
            const delay = Math.min(60_000, 2_000 * 2 ** retryAttemptRef.current)
            retryAttemptRef.current += 1
            clearRetry()
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null
              setRetryToken((value) => value + 1)
            }, delay)
          }
        }
      } finally {
        saveInFlightRef.current = false
        if (
          savedSuccessfully &&
          !conflictState &&
          stateFingerprint(localStateRef.current) !== lastSyncedRef.current
        ) {
          setRetryToken((value) => value + 1)
        }
      }
    }, 900)

    return () => window.clearTimeout(timer)
  }, [
    authMode,
    clearRetry,
    conflictState,
    localFingerprint,
    principal,
    retryToken,
    showSaved,
    updatePendingChanges,
  ])

  useEffect(() => {
    const handleOffline = () => {
      if (authMode === 'signed-in') {
        setSyncStatus('offline')
        setSyncMessage(offlineMessage(pendingChangesRef.current))
      }
    }
    const handleOnline = () => {
      retryAttemptRef.current = 0
      clearRetry()
      lastSyncedRef.current = ''
      setRetryToken((value) => value + 1)
    }
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [authMode, clearRetry])

  const reloadCloudData = useCallback(() => {
    if (!conflictState || !principal) return
    const state: LocalState = {
      rounds: conflictState.rounds,
      courses: conflictState.courses,
      deletedCourseKeys: conflictState.deletedCourseKeys,
    }
    revisionRef.current = conflictState.revision
    lastSyncedRef.current = stateFingerprint(state)
    applyStateRef.current(state)
    persistMetadata(principal.userId, conflictState)
    observedFingerprintRef.current = lastSyncedRef.current
    updatePendingChanges(0)
    retryAttemptRef.current = 0
    clearRetry()
    setConflictState(null)
    showSaved(conflictState.updatedAt)
  }, [clearRetry, conflictState, principal, showSaved, updatePendingChanges])

  return {
    authMode,
    principal,
    syncStatus,
    syncMessage,
    pendingChanges,
    canUseApp: authMode === 'local' || (authMode === 'signed-in' && ready),
    reloadCloudData,
  }

  function formatSyncTime(updatedAt: string | null): string {
    if (!updatedAt) return 'just now'
    const date = new Date(updatedAt)
    if (Number.isNaN(date.getTime())) return 'just now'
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }

  function offlineMessage(pendingChanges: number): string {
    if (pendingChanges === 0) return 'Offline · Saved locally'
    return `Offline · ${pendingChanges} change${pendingChanges === 1 ? '' : 's'} saved locally`
  }

  function hasLocalContent(state: LocalState): boolean {
    return (
      state.rounds.length > 0 ||
      state.courses.length > 0 ||
      state.deletedCourseKeys.length > 0
    )
  }
}

function persistMetadata(ownerId: string, state: CloudState): void {
  const metadata: CloudMetadata = {
    ownerId,
    revision: state.revision,
    updatedAt: state.updatedAt,
    fingerprint: stateFingerprint(state),
  }
  saveCloudMetadata(metadata)
}
