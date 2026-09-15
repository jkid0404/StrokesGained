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
      userRoles: ['authenticated'],
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

  it('normalizes and enforces the configured email allowlist', () => {
    expect(normalizeUserDetails(' GOLFER@example.COM ')).toBe('golfer@example.com')
    expect(authorizePrincipal(encodePrincipal(), ' golfer@example.com ').authorized).toBe(
      true,
    )
    expect(authorizePrincipal(encodePrincipal(), 'other@example.com')).toMatchObject({
      authorized: false,
      status: 403,
    })
  })

  it('fails closed when authentication or configuration is missing', () => {
    expect(authorizePrincipal(null, 'golfer@example.com')).toMatchObject({
      authorized: false,
      status: 401,
    })
    expect(authorizePrincipal(encodePrincipal(), undefined)).toMatchObject({
      authorized: false,
      status: 500,
    })
  })
})
