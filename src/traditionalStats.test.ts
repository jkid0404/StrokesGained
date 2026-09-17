import { describe, expect, it } from 'vitest'
import { BENCHMARK_VERSION, type Hole, type Round, type Shot } from './domain'
import {
  calculateTraditionalStats,
  traditionalTrendReference,
  traditionalTrendValue,
} from './traditionalStats'

describe('traditional golf statistics', () => {
  it('derives scoring, fairways, GIR, putting, and proximity', () => {
    const round = makeRound([
      hole(1, 4, [
        shot('tee', 400, 'fairway', 150),
        shot('fairway', 150, 'green', 12),
        shot('green', 12, 'green', 2),
        shot('green', 2, 'holed', 0),
      ]),
      hole(2, 3, [
        shot('tee', 170, 'rough', 20),
        shot('rough', 20, 'green', 5),
        shot('green', 5, 'holed', 0),
      ]),
      hole(3, 5, [
        shot('tee', 510, 'rough', 280),
        shot('rough', 280, 'fairway', 90, 1),
        shot('fairway', 90, 'sand', 18),
        shot('sand', 18, 'green', 4),
        shot('green', 4, 'holed', 0),
      ]),
    ])

    const stats = calculateTraditionalStats([round])

    expect(stats).toMatchObject({
      rounds: 1,
      holesPlayed: 3,
      totalStrokes: 13,
      totalPar: 12,
      scoreToPar: 1,
      penaltyStrokes: 1,
      fairways: { made: 1, opportunities: 2 },
      greensInRegulation: { made: 1, opportunities: 3 },
      putts: 4,
      onePutts: 2,
      threePutts: 0,
      scrambling: { made: 1, opportunities: 2 },
      upAndDowns: { made: 2, opportunities: 2 },
      sandSaves: { made: 1, opportunities: 1 },
      scoring: {
        eaglesOrBetter: 0,
        birdies: 0,
        pars: 2,
        bogeys: 1,
        doubleBogeysOrWorse: 0,
      },
    })
    expect(stats.puttsPerHole).toBeCloseTo(4 / 3)
    expect(stats.puttsPerGreenInRegulation).toBe(2)
    expect(stats.approachProximityFeet).toBe(12)
    expect(stats.parScoring[4].average).toBe(4)
    expect(stats.parScoring[3].average).toBe(3)
    expect(stats.parScoring[5].average).toBe(6)
  })

  it('ignores incomplete holes and recognizes tee shots that reach or hole out on the green', () => {
    const round = makeRound([
      hole(1, 4, [
        shot('tee', 310, 'green', 20),
        shot('green', 20, 'green', 3),
        shot('green', 3, 'holed', 0),
      ]),
      hole(2, 3, [shot('tee', 155, 'holed', 0)]),
      hole(3, 4, [shot('tee', 400, 'fairway', 140)]),
    ])

    const stats = calculateTraditionalStats([round])

    expect(stats.holesPlayed).toBe(2)
    expect(stats.fairways).toEqual({ made: 1, opportunities: 1 })
    expect(stats.greensInRegulation).toEqual({ made: 2, opportunities: 2 })
    expect(stats.scoring.eaglesOrBetter).toBe(1)
    expect(stats.scoring.birdies).toBe(1)
  })

  it('does not award a fairway hit when the tee shot carries a penalty', () => {
    const round = makeRound([
      hole(1, 4, [
        shot('tee', 400, 'fairway', 180, 1),
        shot('fairway', 180, 'green', 15),
        shot('green', 15, 'green', 2),
        shot('green', 2, 'holed', 0),
      ]),
    ])

    expect(calculateTraditionalStats([round]).fairways).toEqual({
      made: 0,
      opportunities: 1,
    })
  })

  it('returns null averages when there are no eligible opportunities', () => {
    const stats = calculateTraditionalStats([])

    expect(stats.puttsPerHole).toBeNull()
    expect(stats.puttsPerGreenInRegulation).toBeNull()
    expect(stats.approachProximityFeet).toBeNull()
    expect(stats.parScoring[3].average).toBeNull()
  })

  it('normalizes count trends to 18 holes and pools percentage references', () => {
    const nineHoleRound = makeRound([
      hole(1, 4, [
        shot('tee', 400, 'fairway', 150),
        shot('fairway', 150, 'green', 12),
        shot('green', 12, 'holed', 0),
      ]),
    ])
    const missedFairwayRound = makeRound([
      hole(1, 4, [
        shot('tee', 400, 'rough', 150),
        shot('rough', 150, 'green', 12),
        shot('green', 12, 'holed', 0),
      ]),
      hole(2, 4, [
        shot('tee', 400, 'rough', 150),
        shot('rough', 150, 'green', 12),
        shot('green', 12, 'holed', 0),
      ]),
    ])

    expect(traditionalTrendValue(nineHoleRound, 'score-per-18')).toBe(54)
    expect(traditionalTrendValue(nineHoleRound, 'fairways')).toBe(100)
    expect(
      traditionalTrendReference(
        [nineHoleRound, missedFairwayRound],
        'fairways',
      ),
    ).toBeCloseTo(100 / 3)
    expect(traditionalTrendValue(nineHoleRound, 'sand-saves')).toBeNull()
  })
})

function makeRound(holes: Hole[]): Round {
  return {
    id: 'round',
    courseName: 'Test course',
    teeName: 'Blue',
    playedOn: '2026-09-16',
    createdAt: '2026-09-16T12:00:00Z',
    status: 'complete',
    benchmarkVersion: BENCHMARK_VERSION,
    holes,
  }
}

function hole(number: number, par: number, shots: Shot[]): Hole {
  return { number, par, yardage: 400, shots }
}

function shot(
  startLie: Shot['start']['lie'],
  startDistance: number,
  finishLie: Shot['finish']['lie'],
  finishDistance: number,
  penaltyStrokes = 0,
): Shot {
  return {
    id: crypto.randomUUID(),
    start: {
      lie: startLie,
      distance: startDistance,
      unit: startLie === 'green' ? 'feet' : 'yards',
    },
    finish: {
      lie: finishLie,
      distance: finishDistance,
      unit: finishLie === 'green' || finishLie === 'holed' ? 'feet' : 'yards',
    },
    penaltyStrokes,
  }
}
