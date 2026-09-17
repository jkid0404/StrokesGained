import { describe, expect, it } from 'vitest'
import {
  buildClubAnalytics,
  buildCourseSplits,
  buildStrokesGainedSummary,
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
  it('summarizes total and category strokes gained across rounds', () => {
    const summary = buildStrokesGainedSummary([
      makeRound('one', 'Alpha', 'Blue', '2026-01-01', 9, 400),
      makeRound('two', 'Alpha', 'Blue', '2026-01-02', 9, 425),
    ])

    expect(summary.supportedRounds).toBe(2)
    expect(summary.totalPer18).not.toBeNull()
    expect(summary.categories['off-the-tee'].shots).toBe(18)
    expect(summary.categories['off-the-tee'].per18).not.toBeNull()
    expect(summary.categories.putting).toEqual({ per18: 0, shots: 0 })
    expect(
      Object.values(summary.categories).reduce(
        (total, category) => total + (category.per18 ?? 0),
        0,
      ),
    ).toBeCloseTo(summary.totalPer18!)
  })

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
      hole.shots[0].club = index < 3 ? 'Driver' : '3 wood'
    })

    const metrics = buildClubAnalytics(
      [round],
      'off-the-tee',
      ['Driver', '3 wood', 'Putter'],
    )
    expect(metrics.map((metric) => [metric.club, metric.shots])).toEqual([
      ['Driver', 3],
      ['3 wood', 6],
      ['Putter', 0],
      ['Putter', 0],
      ['Putter', 0],
      ['Putter', 0],
    ])
    expect(metrics[0].averageDistance).toBe(400)
    expect(metrics[0].distanceUnit).toBe('yards')
  })

  it('splits putter and 58 wedge metrics into ordered distance bands', () => {
    const round = makeBucketRound()
    const metrics = buildClubAnalytics(
      [round],
      'total',
      ['58 wedge', 'Putter'],
    )

    expect(
      metrics.map((metric) => [metric.club, metric.distanceBand, metric.shots]),
    ).toEqual([
      ['58 wedge', '≤30 yd', 1],
      ['58 wedge', '31–65 yd', 1],
      ['58 wedge', '66+ yd', 1],
      ['Putter', '0–6 ft', 2],
      ['Putter', '7–15 ft', 1],
      ['Putter', '16–30 ft', 1],
      ['Putter', '31+ ft', 1],
    ])
  })

  it('includes every bag club and distance band when no shots are recorded', () => {
    const metrics = buildClubAnalytics(
      [],
      'total',
      ['Driver', '58 wedge', 'Putter'],
    )

    expect(metrics).toHaveLength(8)
    expect(metrics.every((metric) => metric.shots === 0)).toBe(true)
    expect(metrics.every((metric) => metric.averageStrokesGained === null)).toBe(
      true,
    )
    expect(metrics.map((metric) => metric.club)).toEqual([
      'Driver',
      '58 wedge',
      '58 wedge',
      '58 wedge',
      'Putter',
      'Putter',
      'Putter',
      'Putter',
    ])
  })

  it('uses displayed whole-number distances at bucket boundaries', () => {
    const round = makeBucketRound()
    round.holes[0].shots[0].start.distance = 2.4
    round.holes[5].shots[0].start.distance = 30.4

    const metrics = buildClubAnalytics(
      [round],
      'total',
      ['58 wedge', 'Putter'],
    )

    expect(metrics.find((metric) => metric.key === 'putter::0-6')?.shots).toBe(2)
    expect(metrics.find((metric) => metric.key === '58 wedge::0-30')?.shots).toBe(1)
  })

  it('converts off-green Putter distances from yards to feet', () => {
    const round = makeBucketRound()
    round.holes.push({
      number: 9,
      par: 4,
      yardage: 400,
      shots: [
        {
          id: 'putter-off-green',
          start: { lie: 'fairway', distance: 12, unit: 'yards' },
          finish: { lie: 'holed', distance: 0, unit: 'feet' },
          penaltyStrokes: 0,
          club: 'Putter',
        },
      ],
    })

    const metric = buildClubAnalytics([round], 'total', ['Putter']).find(
      (item) => item.key === 'putter::31-plus',
    )

    expect(metric?.distanceBand).toBe('31+ ft')
    expect(metric?.distanceUnit).toBe('feet')
    expect(metric?.shots).toBe(2)
    expect(metric?.averageDistance).toBe(38)
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

function makeBucketRound(): Round {
  const shots = [
    ['Putter', 'green', 2],
    ['Putter', 'green', 4],
    ['Putter', 'green', 10],
    ['Putter', 'green', 20],
    ['Putter', 'green', 40],
    ['58 wedge', 'rough', 20],
    ['58 wedge', 'rough', 50],
    ['58 wedge', 'rough', 80],
  ] as const

  return {
    id: 'buckets',
    courseName: 'Alpha',
    teeName: 'Blue',
    playedOn: '2026-04-01',
    createdAt: '2026-04-01T12:00:00Z',
    status: 'complete',
    benchmarkVersion: BENCHMARK_VERSION,
    holes: shots.map(([club, lie, distance], index) => ({
      number: index + 1,
      par: 4,
      yardage: 400,
      shots: [
        {
          id: `bucket-${index}`,
          start: {
            lie,
            distance,
            unit: lie === 'green' ? ('feet' as const) : ('yards' as const),
          },
          finish: { lie: 'holed' as const, distance: 0, unit: 'feet' as const },
          penaltyStrokes: 0,
          club,
        },
      ],
    })),
  }
}
