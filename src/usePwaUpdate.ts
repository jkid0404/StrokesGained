import { useCallback, useEffect, useRef, useState } from 'react'

export interface PwaUpdateController {
  updateAvailable: boolean
  applyUpdate: () => void
  dismissUpdate: () => void
}

export function usePwaUpdate(): PwaUpdateController {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null)
  const reloadOnControllerChangeRef = useRef(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return

    let updateTimer: number | null = null
    const handleControllerChange = () => {
      if (!reloadOnControllerChangeRef.current) return
      reloadOnControllerChangeRef.current = false
      window.location.reload()
    }

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      registrationRef.current = registration
      if (registration.waiting) setUpdateAvailable(true)

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing
        if (!worker) return
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            setUpdateAvailable(true)
          }
        })
      })

      updateTimer = window.setInterval(() => registration.update(), 60 * 60 * 1000)
    }).catch(() => {
      // The app remains usable without service-worker registration.
    })

    return () => {
      if (updateTimer !== null) window.clearInterval(updateTimer)
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        handleControllerChange,
      )
    }
  }, [])

  const applyUpdate = useCallback(() => {
    const waitingWorker = registrationRef.current?.waiting
    if (!waitingWorker) return
    reloadOnControllerChangeRef.current = true
    waitingWorker.postMessage({ type: 'SKIP_WAITING' })
  }, [])

  return {
    updateAvailable,
    applyUpdate,
    dismissUpdate: () => setUpdateAvailable(false),
  }
}
