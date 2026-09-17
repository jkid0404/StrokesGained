import { describe, expect, it } from 'vitest'
import {
  authorizePrincipal,
  normalizeUserDetails,
  parseClientPrincipal,
} from './auth.js'

function encodePrincipal(overrides: Record<string, unknown> = {}): string {
  return Buffer.from(
    JSON.stringify({
      identityProvider: 'aad',
      userId: 'stable-owner-id',
      userDetails: 'Golfer@Example.com',
      userRoles: ['authenticated', 'golfer'],
      ...overrides,
    }),
  ).toString('base64')
}

describe('Static Web Apps authentication', () => {
  it('parses a valid x-ms-client-principal value', () => {
    expect(parseClientPrincipal(encodePrincipal())?.userId).toBe('stable-owner-id')
  })

  it('rejects malformed or incomplete principal values', () => {
    expect(parseClientPrincipal('not-base64-json')).toBeNull()
    expect(parseClientPrincipal(encodePrincipal({ userId: '' }))).toBeNull()
  })

  it('authorizes invited golfers and role-based admins', () => {
    expect(normalizeUserDetails(' GOLFER@example.COM ')).toBe('golfer@example.com')
    expect(authorizePrincipal(encodePrincipal(), undefined)).toMatchObject({
      authorized: true,
      isAdmin: false,
    })
    expect(
      authorizePrincipal(
        encodePrincipal({ userRoles: ['authenticated', 'admin'] }),
        undefined,
      ),
    ).toMatchObject({
      authorized: true,
      isAdmin: true,
    })
  })

  it('bootstraps the configured existing account as an admin', () => {
    expect(
      authorizePrincipal(
        encodePrincipal({ userRoles: ['authenticated'] }),
        ' golfer@example.com ',
      ),
    ).toMatchObject({
      authorized: true,
      isAdmin: true,
    })
  })

  it('rejects uninvited accounts and non-Microsoft providers', () => {
    expect(
      authorizePrincipal(
        encodePrincipal({ userRoles: ['authenticated'] }),
        'other@example.com',
      ),
    ).toMatchObject({
      authorized: false,
      status: 403,
    })
    expect(
      authorizePrincipal(encodePrincipal({ identityProvider: 'github' }), undefined),
    ).toMatchObject({ authorized: false, status: 403 })
  })

  it('fails closed when authentication is missing', () => {
    expect(authorizePrincipal(null, undefined)).toMatchObject({
      authorized: false,
      status: 401,
    })
  })
})
