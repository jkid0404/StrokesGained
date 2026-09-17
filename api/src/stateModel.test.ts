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
            aliases: ['old test course::blue'],
            holes: { 1: { par: 4, yardage: 410 } },
          },
        ],
        deletedCourseKeys: ['course::tee'],
        clubs: ['Driver', '7 iron', 'Putter'],
        revision: 3,
      }),
    ).toMatchObject({ clubs: ['Driver', '7 iron', 'Putter'], revision: 3 })
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

  it('accepts optional club and note fields and enforces their limits', () => {
    const shot = {
      id: 'shot-1',
      start: { lie: 'fairway', distance: 150, unit: 'yards' },
      finish: { lie: 'green', distance: 15, unit: 'feet' },
      penaltyStrokes: 0,
      club: '7 iron',
      note: 'Into the wind',
    }
    const payload = {
      rounds: [
        {
          id: 'round-1',
          courseName: 'Test course',
          teeName: 'Blue',
          playedOn: '2026-09-15',
          createdAt: '2026-09-15T12:00:00Z',
          status: 'complete',
          benchmarkVersion: 'kaggle-evancallaghan-v1-2023',
          holes: [{ number: 1, par: 4, yardage: 400, shots: [shot] }],
        },
      ],
      courses: [],
      deletedCourseKeys: [],
      revision: 0,
    }

    expect(validateStatePayload(payload)).toMatchObject({ revision: 0 })
    expect(() =>
      validateStatePayload({
        ...payload,
        rounds: [
          {
            ...payload.rounds[0],
            holes: [
              {
                ...payload.rounds[0].holes[0],
                shots: [{ ...shot, note: 'x'.repeat(301) }],
              },
            ],
          },
        ],
      }),
    ).toThrow(ValidationError)
  })

  it('accepts an omitted or empty bag for compatibility', () => {
    const payload = {
      rounds: [],
      courses: [],
      deletedCourseKeys: [],
      revision: 0,
    }

    expect(validateStatePayload(payload)).not.toHaveProperty('clubs')
    expect(validateStatePayload({ ...payload, clubs: [] })).toMatchObject({
      clubs: [],
    })
  })

  it('rejects invalid or duplicate club names', () => {
    const payload = {
      rounds: [],
      courses: [],
      deletedCourseKeys: [],
      revision: 0,
    }

    for (const clubs of [
      [''],
      [' Driver'],
      ['x'.repeat(41)],
      ['Driver', 'driver'],
      Array.from({ length: 101 }, (_, index) => `Club ${index}`),
    ]) {
      expect(() => validateStatePayload({ ...payload, clubs })).toThrow(
        ValidationError,
      )
    }
  })
})
