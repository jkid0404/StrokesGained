import { describe, expect, it } from 'vitest'
import {
  PayloadTooLargeError,
  validateStatePayload,
  ValidationError,
} from './stateModel.js'

describe('cloud state validation', () => {
  it('accepts the expected client-owned fields', () => {
    expect(
      validateStatePayload({
        rounds: [
          {
            id: 'round-1',
            courseName: 'Test course',
            teeName: 'Blue',
            playedOn: '2026-09-15',
            createdAt: '2026-09-15T12:00:00Z',
            status: 'draft',
            benchmarkVersion: 'provisional-synthetic-v2',
            holes: [],
          },
        ],
        courses: [
          {
            key: 'test course::blue',
            name: 'Test course',
            teeName: 'Blue',
            holes: { 1: { par: 4, yardage: 410 } },
          },
        ],
        deletedCourseKeys: ['course::tee'],
        revision: 3,
      }),
    ).toMatchObject({ revision: 3 })
  })

  it('rejects owner identity and invalid revisions from the body', () => {
    expect(() =>
      validateStatePayload({
        ownerId: 'attacker-selected',
        rounds: [],
        courses: [],
        deletedCourseKeys: [],
        revision: 0,
      }),
    ).toThrow(ValidationError)
    expect(() =>
      validateStatePayload({
        rounds: [],
        courses: [],
        deletedCourseKeys: [],
        revision: -1,
      }),
    ).toThrow(ValidationError)
  })

  it('rejects unreasonable payload sizes', () => {
    const rounds = Array.from({ length: 5_000 }, (_, index) => ({
      id: `round-${index}-${'x'.repeat(100)}`,
      courseName: 'Test course',
      teeName: 'Blue',
      playedOn: '2026-09-15',
      createdAt: '2026-09-15T12:00:00Z',
      status: 'draft',
      benchmarkVersion: 'provisional-synthetic-v2',
      holes: [],
    }))

    expect(() =>
      validateStatePayload({
        rounds,
        courses: [],
        deletedCourseKeys: [],
        revision: 0,
      }),
    ).toThrow(PayloadTooLargeError)
  })

  it('rejects invalid nested round data', () => {
    expect(() =>
      validateStatePayload({
        rounds: [{ id: 'incomplete' }],
        courses: [],
        deletedCourseKeys: [],
        revision: 0,
      }),
    ).toThrow(ValidationError)
  })
})
