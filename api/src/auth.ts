export interface ClientPrincipal {
  identityProvider: string
  userId: string
  userDetails: string
  userRoles: string[]
}

export type AuthorizationResult =
  | {
      authorized: true
      principal: ClientPrincipal
      isAdmin: boolean
    }
  | { authorized: false; status: 401 | 403; message: string }

export function normalizeUserDetails(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

export function parseClientPrincipal(encoded: string | null): ClientPrincipal | null {
  if (!encoded) return null

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as unknown
    if (!isRecord(parsed)) return null

    const { identityProvider, userId, userDetails, userRoles } = parsed
    if (
      typeof identityProvider !== 'string' ||
      typeof userId !== 'string' ||
      userId.trim() === '' ||
      typeof userDetails !== 'string' ||
      userDetails.trim() === '' ||
      !Array.isArray(userRoles) ||
      !userRoles.every((role) => typeof role === 'string')
    ) {
      return null
    }

    return { identityProvider, userId, userDetails, userRoles }
  } catch {
    return null
  }
}

export function authorizePrincipal(
  encodedPrincipal: string | null,
  bootstrapAdminEmail: string | undefined,
): AuthorizationResult {
  const principal = parseClientPrincipal(encodedPrincipal)
  if (!principal) {
    return { authorized: false, status: 401, message: 'Authentication is required.' }
  }

  if (principal.identityProvider.toLocaleLowerCase('en-US') !== 'aad') {
    return {
      authorized: false,
      status: 403,
      message: 'Microsoft authentication is required.',
    }
  }

  const roles = new Set(
    principal.userRoles.map((role) => role.toLocaleLowerCase('en-US')),
  )
  const isBootstrapAdmin =
    Boolean(bootstrapAdminEmail?.trim()) &&
    normalizeUserDetails(principal.userDetails) ===
      normalizeUserDetails(bootstrapAdminEmail!)
  const isAdmin = isBootstrapAdmin || roles.has('admin')

  if (!isAdmin && !roles.has('golfer')) {
    return {
      authorized: false,
      status: 403,
      message: 'This Microsoft account has not been invited to the application.',
    }
  }

  return { authorized: true, principal, isAdmin }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
