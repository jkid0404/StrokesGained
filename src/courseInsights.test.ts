import { describe, expect, it } from 'vitest'
import { buildCourseInsights } from './courseInsights'
import {
  BENCHMARK_VERSION,
  courseKey,
  type CourseTemplate,
  type Hole,
  type Round,
} from './domain'

const course: CourseTemplate = {
  key: courseKey('Alpha', 'Blue'),
  name: 'Alpha',
  teeName: 'Blue',
  holes: {},
}

describe('course and hole insights', () => {
  it('matches completed rounds by course and tee and aggregates hole numbers', () => {
    const rounds = [
      makeRound('one', 'Alpha', 'Blue', '2026-01-01', [
        makeHole(10, 4, 'fairway'),
        makeHole(11, 3, 'green'),
      ]),
      makeRound('two', 'Alpha', 'Blue', '2026-02-01', [
        makeHole(10, 5, 'rough'),
      ]),
      makeRound('wrong-tee', 'Alpha', 'White', '2026-03-01', [
        makeHole(10, 4, 'fairway'),
      ]),
      {
        ...makeRound('draft', 'Alpha', 'Blue', '2026-04-01', [
          makeHole(10, 4, 'fairway'),
        ]),
        status: 'draft' as const,
      },
    ]

    const insights = buildCourseInsights(rounds, course)

    expect(insights.rounds).toBe(2)
    expect(insights.latestPlayedOn).toBe('2026-02-01')
    expect(insights.holes.map((hole) => hole.holeNumber)).toEqual([10, 11])
    expect(insights.holes[0]).toMatchObject({
      parLabel: '4–5',
      plays: 2,
      fairways: { made: 1, opportunities: 2 },
      established: false,
    })
  })

  it('ranks recurring trouble holes by score to par', () => {
    const rounds = Array.from({ length: 3 }, (_, index) =>
      makeRound(`round-${index}`, 'Alpha', 'Blue', `2026-01-0${index + 1}`, [
        makeHole(1, 4, 'fairway', 0),
        makeHole(2, 4, 'rough', 1),
      ]),
    )

    const insights = buildCourseInsights(rounds, course)

    expect(insights.troubleHoles[0].holeNumber).toBe(2)
    expect(insights.troubleHoles[0].established).toBe(true)
    expect(insights.traditionalStats.holesPlayed).toBe(6)
    expect(insights.averageStrokesGainedPer18).not.toBeNull()
  })

  it('returns empty insight values when a course has no completed rounds', () => {
    const insights = buildCourseInsights([], course)

    expect(insights.rounds).toBe(0)
    expect(insights.latestPlayedOn).toBeNull()
    expect(insights.averageStrokesGainedPer18).toBeNull()
    expect(insights.holes).toEqual([])
  })

  it('retains historical rounds through course and tee renames', () => {
    const renamedCourse: CourseTemplate = {
      ...course,
      key: courseKey('Alpha Golf Club', 'Gold'),
      name: 'Alpha Golf Club',
      teeName: 'Gold',
      aliases: [course.key],
    }
    const historicalRound = makeRound(
      'historical',
      'Alpha',
      'Blue',
      '2026-01-01',
      [makeHole(1, 4, 'fairway')],
    )

    expect(buildCourseInsights([historicalRound], renamedCourse).rounds).toBe(1)
  })
})

function makeRound(
  id: string,
  courseName: string,
  teeName: string,
  playedOn: string,
  holes: Hole[],
): Round {
  return {
    id,
    courseName,
    teeName,
    playedOn,
    createdAt: `${playedOn}T12:00:00Z`,
    status: 'complete',
    benchmarkVersion: BENCHMARK_VERSION,
    holes,
  }
}

function makeHole(
  number: number,
  par: number,
  teeFinish: 'fairway' | 'rough' | 'green',
  penaltyStrokes = 0,
): Hole {
  return {
    number,
    par,
    yardage: 400,
    shots: [
      {
        id: `${number}-tee`,
        start: { lie: 'tee', distance: 400, unit: 'yards' },
        finish: {
          lie: teeFinish,
          distance: teeFinish === 'green' ? 12 : 150,
          unit: teeFinish === 'green' ? 'feet' : 'yards',
        },
        penaltyStrokes,
      },
      ...(teeFinish === 'green'
        ? []
        : [
            {
              id: `${number}-approach`,
              start: {
                lie: teeFinish,
                distance: 150,
                unit: 'yards' as const,
              },
              finish: { lie: 'green' as const, distance: 10, unit: 'feet' as const },
              penaltyStrokes: 0,
            },
          ]),
      {
        id: `${number}-putt`,
        start: { lie: 'green', distance: teeFinish === 'green' ? 12 : 10, unit: 'feet' },
        finish: { lie: 'holed', distance: 0, unit: 'feet' },
        penaltyStrokes: 0,
      },
    ],
  }
}
