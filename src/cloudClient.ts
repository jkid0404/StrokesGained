import type { CloudState, LocalState } from './cloudState'
import { CLUB_OPTIONS } from './domain'

export interface ClientPrincipal {
  identityProvider: string
  userId: string
  userDetails: string
  userRoles: string[]
}

export type AuthResult =
  | { available: false; principal: null }
  | { available: true; principal: ClientPrincipal | null }

export class CloudRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function fetchAuthState(signal?: AbortSignal): Promise<AuthResult> {
  try {
    const response = await fetch('/.auth/me', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal,
    })
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      return { available: false, principal: null }
    }

    const body = (await response.json()) as { clientPrincipal?: ClientPrincipal | null }
    if (!Object.prototype.hasOwnProperty.call(body, 'clientPrincipal')) {
      return { available: false, principal: null }
    }
    return { available: true, principal: body.clientPrincipal ?? null }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    const localHost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '::1'
    return { available: !localHost, principal: null }
  }
}

export async function fetchCloudState(signal?: AbortSignal): Promise<CloudState> {
  const response = await fetch('/api/state', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  })
  return parseStateResponse(response)
}

export async function putCloudState(
  state: LocalState,
  revision: number,
  signal?: AbortSignal,
): Promise<CloudState> {
  const response = await fetch('/api/state', {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...state, revision }),
    signal,
  })
  return parseStateResponse(response, true)
}

async function parseStateResponse(
  response: Response,
  allowConflict = false,
): Promise<CloudState> {
  const body = (await response.json().catch(() => null)) as
    | (Partial<CloudState> & { error?: string })
    | null

  if (!response.ok) {
    const message = body?.error ?? `Cloud request failed with status ${response.status}.`
    const conflictState = normalizeCloudState(body)
    if (allowConflict && response.status === 409 && conflictState) {
      throw new CloudConflictError(message, conflictState)
    }
    throw new CloudRequestError(message, response.status)
  }

  const state = normalizeCloudState(body)
  if (!state) {
    throw new CloudRequestError('The cloud returned an invalid state response.', 502)
  }
  return state
}

export class CloudConflictError extends Error {
  readonly current: CloudState

  constructor(message: string, current: CloudState) {
    super(message)
    this.current = current
  }
}

function normalizeCloudState(value: unknown): CloudState | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<CloudState>
  if (
    Array.isArray(candidate.rounds) &&
    Array.isArray(candidate.courses) &&
    Array.isArray(candidate.deletedCourseKeys) &&
    (candidate.clubs === undefined ||
      (Array.isArray(candidate.clubs) &&
        candidate.clubs.every((club) => typeof club === 'string'))) &&
    Number.isSafeInteger(candidate.revision) &&
    (typeof candidate.updatedAt === 'string' || candidate.updatedAt === null) &&
    typeof candidate.exists === 'boolean'
  ) {
    return {
      rounds: candidate.rounds,
      courses: candidate.courses,
      deletedCourseKeys: candidate.deletedCourseKeys,
      clubs: candidate.clubs ?? [...CLUB_OPTIONS],
      revision: candidate.revision as number,
      updatedAt: candidate.updatedAt,
      exists: candidate.exists,
    }
  }
  return null
}
