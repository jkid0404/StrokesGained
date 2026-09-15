import { describe, expect, it } from 'vitest'
import { decideBootstrap, stateFingerprint, type CloudState, type LocalState } from './cloudState'

const emptyLocal: LocalState = { rounds: [], courses: [], deletedCourseKeys: [] }

function cloud(overrides: Partial<CloudState> = {}): CloudState {
  return {
    ...emptyLocal,
    revision: 0,
    updatedAt: null,
    exists: false,
    ...overrides,
  }
}

describe('cloud bootstrap decisions', () => {
  it('uploads existing local data only when no cloud document exists', () => {
    const local = { ...emptyLocal, deletedCourseKeys: ['old-course::blue'] }
    expect(decideBootstrap(local, cloud())).toEqual({
      action: 'upload-local',
      state: local,
      revision: 0,
    })
  })

  it('uses an existing cloud document even when it is intentionally empty', () => {
    expect(decideBootstrap(emptyLocal, cloud({ exists: true, revision: 7 }))).toEqual({
      action: 'use-cloud',
      state: emptyLocal,
      revision: 7,
    })
  })

  it('uses stable fingerprints for sync loop prevention', () => {
    expect(stateFingerprint(emptyLocal)).toBe(stateFingerprint({ ...emptyLocal }))
    expect(
      stateFingerprint({ ...emptyLocal, deletedCourseKeys: ['course::tee'] }),
    ).not.toBe(stateFingerprint(emptyLocal))
  })
})
