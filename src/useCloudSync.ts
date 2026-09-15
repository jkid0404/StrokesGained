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

  const localStateRef = useRef(localState)
  const applyStateRef = useRef(applyState)
  const revisionRef = useRef(0)
  const lastSyncedRef = useRef('')
  const initializedOwnerRef = useRef<string | null>(null)
  const saveInFlightRef = useRef(false)
  const localFingerprint = stateFingerprint(localState)

  useEffect(() => {
    localStateRef.current = localState
    applyStateRef.current = applyState
  }, [applyState, localState])

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
          setSyncMessage('Uploading local data…')
          const saved = await putCloudState(decision.state, 0, controller.signal)
          revisionRef.current = saved.revision
          lastSyncedRef.current = stateFingerprint(decision.state)
          persistMetadata(ownerId, saved)
        } else {
          lastSyncedRef.current = stateFingerprint(decision.state)
          applyStateRef.current(decision.state)
          persistMetadata(ownerId, cloudState)
        }

        setConflictState(null)
        setSyncStatus('saved')
        setSyncMessage('Saved to cloud')
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
        } else {
          lastSyncedRef.current = ''
        }
        initializedOwnerRef.current = ownerId
        setSyncStatus(navigator.onLine ? 'error' : 'offline')
        setSyncMessage(
          navigator.onLine ? 'Cloud unavailable; using cached data' : 'Offline; using cached data',
        )
        setReady(true)
      })

    return () => controller.abort()
  }, [authMode, principal])

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
      let savedSuccessfully = false
      saveInFlightRef.current = true
      setSyncStatus('saving')
      setSyncMessage('Saving…')

      try {
        const saved = await putCloudState(stateToSave, revisionRef.current)
        revisionRef.current = saved.revision
        lastSyncedRef.current = sentFingerprint
        persistMetadata(principal.userId, saved)
        savedSuccessfully = true
        setSyncStatus('saved')
        setSyncMessage('Saved to cloud')
      } catch (error) {
        if (error instanceof CloudConflictError) {
          setConflictState(error.current)
          setSyncStatus('conflict')
          setSyncMessage('Cloud data changed elsewhere')
        } else {
          setSyncStatus(navigator.onLine ? 'error' : 'offline')
          setSyncMessage(navigator.onLine ? 'Cloud save failed' : 'Offline; changes are local')
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
  }, [authMode, conflictState, localFingerprint, principal, retryToken])

  useEffect(() => {
    const handleOffline = () => {
      if (authMode === 'signed-in') {
        setSyncStatus('offline')
        setSyncMessage('Offline; changes are local')
      }
    }
    const handleOnline = () => {
      lastSyncedRef.current = ''
      setRetryToken((value) => value + 1)
    }
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [authMode])

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
    setConflictState(null)
    setSyncStatus('saved')
    setSyncMessage('Reloaded cloud data')
  }, [conflictState, principal])

  return {
    authMode,
    principal,
    syncStatus,
    syncMessage,
    canUseApp: authMode === 'local' || (authMode === 'signed-in' && ready),
    reloadCloudData,
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
