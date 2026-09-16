import { describe, expect, it } from 'vitest'
import {
  BENCHMARK_VERSION,
  CLUB_OPTIONS,
  buildCourseTemplates,
  buildHoleSequence,
  buildPersonalBaseline,
  calculateRound,
  calculateShot,
  calculateCumulativeMetrics,
  defaultFinishLie,
  defaultClub,
  defaultDistanceEntry,
  expectedStrokes,
  excludeDeletedCourseTemplates,
  mergeCourseTemplates,
  type Round,
  type Shot,
} from './domain'

describe('Kaggle benchmark', () => {
  it('returns values from the imported shot and putting tables', () => {
    expect(BENCHMARK_VERSION).toBe('kaggle-evancallaghan-v1-2023')
    expect(expectedStrokes({ lie: 'fairway', distance: 3, unit: 'yards' })).toBe(2)
    expect(expectedStrokes({ lie: 'fairway', distance: 100, unit: 'yards' })).toBe(2.8)
    expect(expectedStrokes({ lie: 'sand', distance: 20, unit: 'yards' })).toBe(2.53)
    expect(expectedStrokes({ lie: 'green', distance: 8, unit: 'feet' })).toBe(1.5)
    expect(expectedStrokes({ lie: 'tee', distance: 600, unit: 'yards' })).toBe(4.82)
    expect(expectedStrokes({ lie: 'green', distance: 90, unit: 'feet' })).toBe(2.4)
  })

  describe('hole sequence', () => {
    it('wraps an 18-hole round after hole 18', () => {
      expect(buildHoleSequence(18, 10).map((hole) => hole.number)).toEqual([
        10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      ])
    })

    it('wraps within the selected nine for a 9-hole round', () => {
      expect(buildHoleSequence(9, 5).map((hole) => hole.number)).toEqual([
        5, 6, 7, 8, 9, 1, 2, 3, 4,
      ])
      expect(buildHoleSequence(9, 16).map((hole) => hole.number)).toEqual([
        16, 17, 18, 10, 11, 12, 13, 14, 15,
      ])
    })
  })

  it('interpolates decimal distances and rejects values outside the dataset', () => {
    expect(expectedStrokes({ lie: 'fairway', distance: 60, unit: 'yards' })).toBe(2.7)
    expect(expectedStrokes({ lie: 'green', distance: 4, unit: 'feet' })).toBe(1.13)
    expect(expectedStrokes({ lie: 'fairway', distance: 3.5, unit: 'yards' })).toBeCloseTo(
      2.015,
    )
    expect(() => expectedStrokes({ lie: 'green', distance: 91, unit: 'feet' })).toThrow(
      'supports 1-90 ft',
    )
    expect(() => expectedStrokes({ lie: 'tee', distance: 99, unit: 'yards' })).toThrow(
      'supports 100-600 yd',
    )
    expect(() => expectedStrokes({ lie: 'fairway', distance: 601, unit: 'yards' })).toThrow(
      'supports 3-600 yd',
    )
    expect(() => expectedStrokes({ lie: 'recovery', distance: 100, unit: 'yards' })).toThrow(
      'Recovery shots are not supported',
    )
  })
})

describe('strokes gained calculations', () => {
  it('calculates a shot including penalties', () => {
    const shot: Shot = {
      id: 'shot-1',
      start: { lie: 'fairway', distance: 100, unit: 'yards' },
      finish: { lie: 'green', distance: 8, unit: 'feet' },
      penaltyStrokes: 1,
    }

    expect(calculateShot(shot, 1, 4).strokesGained).toBeCloseTo(-0.7)
  })

  it('marks a round unsupported when any shot is outside benchmark coverage', () => {
    const round = makeRound('unsupported', '2026-01-01', 601)
    expect(calculateRound(round).totalStrokesGained).toBeNull()
  })

  it('supports tee shots through 600 yards', () => {
    const round = makeRound('supported', '2026-01-01', 600)
    expect(calculateRound(round).totalStrokesGained).not.toBeNull()
  })
})

describe('default finishing lie', () => {
  it('uses hole and shot context for tee and second shots', () => {
    const tee = { lie: 'tee', distance: 180, unit: 'yards' } as const
    const fairway = { lie: 'fairway', distance: 150, unit: 'yards' } as const

    expect(defaultFinishLie(3, 0, tee, 'rough')).toBe('green')
    expect(defaultFinishLie(4, 0, tee, 'green')).toBe('fairway')
    expect(defaultFinishLie(5, 0, tee, 'sand')).toBe('fairway')
    expect(defaultFinishLie(4, 1, fairway, 'rough')).toBe('green')
    expect(defaultFinishLie(5, 1, fairway, 'sand')).toBe('green')
  })

  it('uses distance from the green and otherwise remembers the manual selection', () => {
    expect(
      defaultFinishLie(4, 2, { lie: 'green', distance: 8, unit: 'feet' }, 'rough'),
    ).toBe('holed')
    expect(
      defaultFinishLie(4, 2, { lie: 'green', distance: 8.1, unit: 'feet' }, 'rough'),
    ).toBe('green')
    expect(
      defaultFinishLie(5, 2, { lie: 'rough', distance: 80, unit: 'yards' }, 'sand'),
    ).toBe('sand')
  })
})

describe('default club', () => {
  it('uses contextual and recently selected club defaults', () => {
    expect(CLUB_OPTIONS).toContain('Putter')
    expect(
      defaultClub({ lie: 'green', distance: 12, unit: 'feet' }, '3 wood', '7 iron'),
    ).toBe('Putter')
    expect(
      defaultClub({ lie: 'tee', distance: 400, unit: 'yards' }, '3 wood', '7 iron'),
    ).toBe('3 wood')
    expect(
      defaultClub({ lie: 'rough', distance: 150, unit: 'yards' }, 'Driver', '7 iron'),
    ).toBe('7 iron')
  })
})

describe('default distance entry', () => {
  it('uses 2 feet from the green and 10 feet for approaches finishing on it', () => {
    expect(
      defaultDistanceEntry({ lie: 'green', distance: 20, unit: 'feet' }, 'green'),
    ).toBe(2)
    expect(
      defaultDistanceEntry({ lie: 'green', distance: 6, unit: 'feet' }, 'holed'),
    ).toBe(2)
    expect(
      defaultDistanceEntry({ lie: 'fairway', distance: 150, unit: 'yards' }, 'green'),
    ).toBe(10)
    expect(
      defaultDistanceEntry({ lie: 'rough', distance: 150, unit: 'yards' }, 'fairway'),
    ).toBe(100)
  })
})

describe('personal baseline', () => {
  it('uses prior eligible rounds and becomes provisional after five', () => {
    const rounds = Array.from({ length: 5 }, (_, index) =>
      makeRound(`round-${index}`, `2026-01-0${index + 1}`, 400),
    )
    const baseline = buildPersonalBaseline(rounds)

    expect(baseline.status).toBe('provisional')
    expect(baseline.includedRounds).toBe(5)
    expect(baseline.averageSgPer18).not.toBeNull()
  })

  describe('saved course templates', () => {
    it('allows saved edits to override round-derived hole details', () => {
      const derived = buildCourseTemplates([makeRound('round', '2026-01-01', 400)])
      const saved = [
        {
          key: 'test course::blue',
          name: 'Test Course',
          teeName: 'Blue',
          holes: { 1: { par: 4, yardage: 375 } },
        },
      ]

      expect(
        mergeCourseTemplates(derived, saved).find((course) => course.teeName === 'Blue')
          ?.holes[1].yardage,
      ).toBe(375)
    })

    describe('cumulative metrics', () => {
      it('sums PGA comparison and starts personal comparison after five prior rounds', () => {
        const rounds = Array.from({ length: 6 }, (_, index) =>
          makeRound(`round-${index}`, `2026-02-0${index + 1}`, 400),
        )
        const cumulative = calculateCumulativeMetrics(rounds)

        expect(cumulative.pgaRoundCount).toBe(6)
        expect(cumulative.versusPgaTour).not.toBeNull()
        expect(cumulative.personalRoundCount).toBe(1)
        expect(cumulative.versusPersonalAverage).toBeCloseTo(0)
      })
    })

    it('keeps separate templates for different tees at the same course', () => {
      const blue = makeRound('blue', '2026-01-01', 400)
      blue.teeName = 'Blue'
      const white = makeRound('white', '2026-01-02', 370)
      white.teeName = 'White'

      const templates = buildCourseTemplates([blue, white])
      expect(templates).toHaveLength(2)
      expect(templates.map((course) => course.teeName).sort()).toEqual(['Blue', 'White'])
    })

    it('excludes templates that were explicitly deleted', () => {
      const courses = buildCourseTemplates([makeRound('round', '2026-01-01', 400)])
      expect(excludeDeletedCourseTemplates(courses, [courses[0].key])).toEqual([])
    })
  })

  describe('course templates', () => {
    it('uses newest valid hole details and fills missing holes from older rounds', () => {
      const older = makeRound('older', '2026-01-01', 400)
      older.courseName = 'Test Course'
      older.holes[1].yardage = 180
      older.holes[1].par = 3

      const newer = makeRound('newer', '2026-02-01', 400)
      newer.courseName = 'test course'
      newer.holes[0].yardage = 390
      newer.holes[1].yardage = 0
      newer.holes[1].par = 0

      const [template] = buildCourseTemplates([older, newer])

      expect(template.name).toBe('test course')
      expect(template.holes[1]).toEqual({ par: 4, yardage: 390 })
      expect(template.holes[2]).toEqual({ par: 3, yardage: 180 })
    })
  })
})

function makeRound(id: string, playedOn: string, yardage: number): Round {
  return {
    id,
    courseName: 'Test course',
    teeName: 'Unspecified tees',
    playedOn,
    createdAt: `${playedOn}T12:00:00Z`,
    status: 'complete',
    benchmarkVersion: BENCHMARK_VERSION,
    holes: Array.from({ length: 9 }, (_, index) => ({
      number: index + 1,
      par: 4,
      yardage,
      shots: [
        {
          id: `${id}-${index}`,
          start: { lie: 'tee' as const, distance: yardage, unit: 'yards' as const },
          finish: { lie: 'holed' as const, distance: 0, unit: 'feet' as const },
          penaltyStrokes: 0,
        },
      ],
    })),
  }
}
