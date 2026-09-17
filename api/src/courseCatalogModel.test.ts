import { describe, expect, it } from 'vitest'
import {
  toCourseCatalogResponse,
  validateCourseCatalogPayload,
} from './courseCatalogModel.js'

describe('shared course catalog model', () => {
  it('accepts a valid catalog payload', () => {
    expect(
      validateCourseCatalogPayload({
        revision: 0,
        courses: [
          {
            key: 'alpha::blue',
            name: 'Alpha',
            teeName: 'Blue',
            holes: { 1: { par: 4, yardage: 400 } },
          },
        ],
      }).courses,
    ).toHaveLength(1)
  })

  it('rejects invalid courses and client-controlled metadata', () => {
    expect(() =>
      validateCourseCatalogPayload({
        revision: 0,
        updatedAt: 'attacker-controlled',
        courses: [],
      }),
    ).toThrow('Unexpected property')
    expect(() =>
      validateCourseCatalogPayload({
        revision: 0,
        courses: [{ key: 'bad', name: 'Bad', teeName: 'Blue', holes: { 19: {} } }],
      }),
    ).toThrow('invalid course')
  })

  it('returns an empty catalog response before seeding', () => {
    expect(toCourseCatalogResponse(null)).toEqual({
      courses: [],
      revision: 0,
      updatedAt: null,
      exists: false,
    })
  })
})
