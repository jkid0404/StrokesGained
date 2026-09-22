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
  defaultHoleYardage,
  expectedStrokes,
  excludeDeletedCourseTemplates,
  holeStrokeExpectations,
  isIronClub,
  mergeCourseTemplates,
  suggestedClub,
  type Round,
  type Shot,
} from './domain'

describe('Kaggle benchmark', () => {
  it('returns values from the imported shot and putting tables', () => {
    expect(BENCHMARK_VERSION).toBe(
      'kaggle-evancallaghan-v1-plus-broadie-recovery-v2-2026',
    )
    expect(expectedStrokes({ lie: 'fairway', distance: 3, unit: 'yards' })).toBe(2)
    expect(expectedStrokes({ lie: 'fairway', distance: 100, unit: 'yards' })).toBe(2.8)
    expect(expectedStrokes({ lie: 'sand', distance: 20, unit: 'yards' })).toBe(2.53)
    expect(expectedStrokes({ lie: 'green', distance: 8, unit: 'feet' })).toBe(1.5)
    expect(expectedStrokes({ lie: 'tee', distance: 600, unit: 'yards' })).toBe(4.82)
    expect(expectedStrokes({ lie: 'green', distance: 90, unit: 'feet' })).toBe(2.4)
    expect(expectedStrokes({ lie: 'recovery', distance: 100, unit: 'yards' })).toBe(
      3.8,
    )
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
    expect(expectedStrokes({ lie: 'recovery', distance: 50, unit: 'yards' })).toBe(3.8)
    expect(expectedStrokes({ lie: 'recovery', distance: 350, unit: 'yards' })).toBe(4.2)
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

  it('counts a stroke-and-distance replay from the tee as off the tee', () => {
    const penalizedShot: Shot = {
      id: 'out-of-bounds',
      start: { lie: 'tee', distance: 400, unit: 'yards' },
      finish: { lie: 'tee', distance: 400, unit: 'yards' },
      penaltyStrokes: 1,
    }
    const replay: Shot = {
      id: 'replay',
      start: penalizedShot.finish,
      finish: { lie: 'fairway', distance: 150, unit: 'yards' },
      penaltyStrokes: 0,
    }

    expect(calculateShot(penalizedShot, 0, 4)).toMatchObject({
      category: 'off-the-tee',
      strokesGained: -2,
    })
    expect(calculateShot(replay, 1, 4).category).toBe('off-the-tee')
    expect(defaultClub(4, 1, replay.start)).toBe('Driver')
    expect(defaultClub(3, 1, { lie: 'tee', distance: 150, unit: 'yards' })).toBe(
      '7 iron',
    )
  })

  it('charges a tee shot for finishing in recovery and separates the pitch-out', () => {
    const drive: Shot = {
      id: 'drive',
      start: { lie: 'tee', distance: 400, unit: 'yards' },
      finish: { lie: 'recovery', distance: 180, unit: 'yards' },
      penaltyStrokes: 0,
    }
    const pitchOut: Shot = {
      id: 'pitch-out',
      start: drive.finish,
      finish: { lie: 'fairway', distance: 140, unit: 'yards' },
      penaltyStrokes: 0,
    }

    expect(calculateShot(drive, 0, 4).strokesGained).toBeCloseTo(-0.83)
    const pitchOutResult = calculateShot(pitchOut, 1, 4)
    expect(pitchOutResult.category).toBe('recovery')
    expect(pitchOutResult.strokesGained).toBeCloseTo(-0.09)
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
    expect(
      defaultFinishLie(
        4,
        1,
        { lie: 'recovery', distance: 180, unit: 'yards' },
        'rough',
      ),
    ).toBe('fairway')
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
    expect(
      defaultFinishLie(4, 2, { lie: 'fairway', distance: 150, unit: 'yards' }, 'tee'),
    ).toBe('fairway')
  })
})

describe('default club', () => {
  it('uses par and shot position for deterministic club defaults', () => {
    expect(CLUB_OPTIONS).toContain('Putter')
    expect(CLUB_OPTIONS).toContain('58 wedge')
    expect(defaultClub(4, 2, { lie: 'green', distance: 12, unit: 'feet' })).toBe(
      'Putter',
    )
    expect(defaultClub(4, 0, { lie: 'tee', distance: 400, unit: 'yards' })).toBe(
      'Driver',
    )
    expect(defaultClub(5, 0, { lie: 'tee', distance: 500, unit: 'yards' })).toBe(
      'Driver',
    )
    expect(defaultClub(3, 0, { lie: 'tee', distance: 150, unit: 'yards' })).toBe(
      '7 iron',
    )
    expect(defaultClub(4, 1, { lie: 'fairway', distance: 150, unit: 'yards' })).toBe(
      '7 iron',
    )
    expect(defaultClub(5, 1, { lie: 'fairway', distance: 250, unit: 'yards' })).toBe(
      '3 wood',
    )
    expect(defaultClub(3, 1, { lie: 'rough', distance: 20, unit: 'yards' })).toBe(
      '58 wedge',
    )
  })

  it('treats numbered, driving, utility, and pitching wedge clubs as irons', () => {
    expect(isIronClub('7 iron')).toBe(true)
    expect(isIronClub('Driving iron')).toBe(true)
    expect(isIronClub('Utility iron')).toBe(true)
    expect(isIronClub('Pitching wedge')).toBe(true)
    expect(isIronClub('58 wedge')).toBe(false)
  })

  it('prefers clubs used from similar positions on the same course and hole', () => {
    const priorRound = makeRound('prior', '2026-01-01', 400)
    priorRound.holes[0].shots[0].club = '3 wood'
    const currentRound = makeRound('current', '2026-02-01', 400)
    currentRound.status = 'draft'
    currentRound.holes[0].shots = []

    expect(
      suggestedClub(
        [priorRound, currentRound],
        currentRound,
        currentRound.holes[0],
        0,
        { lie: 'tee', distance: 400, unit: 'yards' },
        CLUB_OPTIONS,
      ),
    ).toBe('3 wood')
  })

  it('uses similar-distance history across courses and otherwise keeps the fallback', () => {
    const priorRound = makeRound('prior', '2026-01-01', 400)
    priorRound.courseName = 'Another course'
    priorRound.holes[0].shots = [
      {
        id: 'approach',
        start: { lie: 'fairway', distance: 155, unit: 'yards' },
        finish: { lie: 'green', distance: 20, unit: 'feet' },
        penaltyStrokes: 0,
        club: '6 iron',
      },
    ]
    const currentRound = makeRound('current', '2026-02-01', 400)
    currentRound.status = 'draft'
    const currentHole = { ...currentRound.holes[0], shots: [] }

    expect(
      suggestedClub(
        [priorRound],
        currentRound,
        currentHole,
        1,
        { lie: 'fairway', distance: 150, unit: 'yards' },
        CLUB_OPTIONS,
      ),
    ).toBe('6 iron')
    expect(
      suggestedClub(
        [],
        currentRound,
        currentHole,
        1,
        { lie: 'fairway', distance: 150, unit: 'yards' },
        CLUB_OPTIONS,
      ),
    ).toBe('7 iron')
  })

  it('ignores future rounds and recognizes renamed-course aliases', () => {
    const futureRound = makeRound('future', '2026-03-01', 400)
    futureRound.holes[0].shots[0].club = '3 wood'
    const renamedRound = makeRound('renamed', '2026-01-01', 400)
    renamedRound.courseName = 'Old course name'
    renamedRound.holes[0].shots[0].club = '5 wood'
    const currentRound = makeRound('current', '2026-02-01', 400)
    currentRound.courseName = 'New course name'
    currentRound.status = 'draft'
    currentRound.holes[0].shots = []

    expect(
      suggestedClub(
        [futureRound],
        currentRound,
        currentRound.holes[0],
        0,
        { lie: 'tee', distance: 400, unit: 'yards' },
        CLUB_OPTIONS,
      ),
    ).toBe('Driver')
    expect(
      suggestedClub(
        [futureRound, renamedRound],
        currentRound,
        currentRound.holes[0],
        0,
        { lie: 'tee', distance: 400, unit: 'yards' },
        CLUB_OPTIONS,
        ['old course name::unspecified tees'],
      ),
    ).toBe('5 wood')
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

describe('default hole yardage', () => {
  it('uses standard defaults for par 3, 4, and 5 holes', () => {
    expect(defaultHoleYardage(3)).toBe(150)
    expect(defaultHoleYardage(4)).toBe(400)
    expect(defaultHoleYardage(5)).toBe(500)
  })
})

describe('hole stroke expectations', () => {
  it('adjusts the PGA expectation by the personal SG average per hole', () => {
    const pgaOnly = holeStrokeExpectations(400, null)
    const personal = holeStrokeExpectations(400, -9)

    expect(pgaOnly.personal).toBeNull()
    expect(personal.pgaTour).toBeCloseTo(pgaOnly.pgaTour)
    expect(personal.personal).toBeCloseTo(pgaOnly.pgaTour + 0.5)
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
