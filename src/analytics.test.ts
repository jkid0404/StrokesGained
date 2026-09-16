import { describe, expect, it } from 'vitest'
import {
  buildClubAnalytics,
  buildCourseSplits,
  filterTrendRounds,
  personalTrendReference,
  trendValue,
  type TrendFilters,
} from './analytics'
import { BENCHMARK_VERSION, type Round } from './domain'

const allFilters: TrendFilters = {
  courseName: '',
  teeName: '',
  fromDate: '',
  toDate: '',
  roundLength: 'all',
}

describe('trend analytics', () => {
  it('filters completed rounds by course, tee, date, and round length', () => {
    const rounds = [
      makeRound('one', 'Alpha', 'Blue', '2026-01-01', 9, 400),
      makeRound('two', 'Alpha', 'White', '2026-02-01', 18, 400),
      makeRound('three', 'Beta', 'Blue', '2026-03-01', 18, 400),
      { ...makeRound('draft', 'Alpha', 'Blue', '2026-02-15', 18, 400), status: 'draft' as const },
    ]

    expect(
      filterTrendRounds(rounds, {
        ...allFilters,
        courseName: 'Alpha',
        teeName: 'White',
        fromDate: '2026-01-15',
        toDate: '2026-02-28',
        roundLength: '18',
      }).map((round) => round.id),
    ).toEqual(['two'])
  })

  it('normalizes total SG per 18 and category SG per shot', () => {
    const round = makeRound('round', 'Alpha', 'Blue', '2026-01-01', 9, 400)
    const total = trendValue(round, 'total')
    const offTheTee = trendValue(round, 'off-the-tee')

    expect(total).not.toBeNull()
    expect(offTheTee).not.toBeNull()
    expect(total).toBeCloseTo(offTheTee! * 18)
  })

  it('builds course and tee splits from the selected rounds', () => {
    const rounds = [
      makeRound('one', 'Alpha', 'Blue', '2026-01-01', 9, 400),
      makeRound('two', 'Alpha', 'Blue', '2026-02-01', 9, 400),
      makeRound('three', 'Alpha', 'White', '2026-03-01', 9, 450),
    ]

    const splits = buildCourseSplits(rounds, 'total')
    expect(splits).toHaveLength(2)
    expect(splits.find((split) => split.teeName === 'Blue')?.rounds).toBe(2)
  })

  it('provides personal references after five eligible rounds', () => {
    const rounds = Array.from({ length: 5 }, (_, index) =>
      makeRound(
        `round-${index}`,
        'Alpha',
        'Blue',
        `2026-01-0${index + 1}`,
        9,
        400,
      ),
    )

    expect(personalTrendReference(rounds, 'total')).not.toBeNull()
    expect(personalTrendReference(rounds, 'off-the-tee')).not.toBeNull()
  })

  it('aggregates supported strokes gained by recorded club and category', () => {
    const round = makeRound('round', 'Alpha', 'Blue', '2026-01-01', 9, 400)
    round.holes.forEach((hole, index) => {
      hole.shots[0].club = index < 6 ? 'Driver' : '3 wood'
    })

    const metrics = buildClubAnalytics([round], 'off-the-tee')
    expect(metrics.map((metric) => [metric.club, metric.shots])).toEqual([
      ['Driver', 6],
      ['3 wood', 3],
    ])
    expect(metrics[0].averageDistance).toBe(400)
    expect(metrics[0].distanceUnit).toBe('yards')
  })
})

function makeRound(
  id: string,
  courseName: string,
  teeName: string,
  playedOn: string,
  holeCount: 9 | 18,
  yardage: number,
): Round {
  return {
    id,
    courseName,
    teeName,
    playedOn,
    createdAt: `${playedOn}T12:00:00Z`,
    status: 'complete',
    benchmarkVersion: BENCHMARK_VERSION,
    holes: Array.from({ length: holeCount }, (_, index) => ({
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
