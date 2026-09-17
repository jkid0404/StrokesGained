import { shotCategory, type Hole, type Round } from './domain'

export interface CountMetric {
  made: number
  opportunities: number
}

export interface ParScoringMetric {
  holes: number
  strokes: number
  average: number | null
}

export interface TraditionalStats {
  rounds: number
  holesPlayed: number
  totalStrokes: number
  totalPar: number
  scoreToPar: number
  penaltyStrokes: number
  fairways: CountMetric
  greensInRegulation: CountMetric
  putts: number
  puttsPerHole: number | null
  puttsOnGreensInRegulation: number
  puttsPerGreenInRegulation: number | null
  onePutts: number
  threePutts: number
  scrambling: CountMetric
  upAndDowns: CountMetric
  sandSaves: CountMetric
  approachProximityFeet: number | null
  approachProximityShots: number
  scoring: {
    eaglesOrBetter: number
    birdies: number
    pars: number
    bogeys: number
    doubleBogeysOrWorse: number
  }
  parScoring: Record<3 | 4 | 5, ParScoringMetric>
}

export type TraditionalTrendMetric =
  | 'score-per-18'
  | 'score-to-par-per-18'
  | 'fairways'
  | 'gir'
  | 'putts-per-18'
  | 'putts-per-gir'
  | 'scrambling'
  | 'up-and-downs'
  | 'sand-saves'
  | 'penalties-per-18'
  | 'one-putts'
  | 'three-putts'
  | 'approach-proximity'

export interface TraditionalTrendMetricDefinition {
  label: string
  detail: string
  group: 'Scoring' | 'Driving' | 'Approach' | 'Short game' | 'Putting'
  higherIsBetter: boolean
  format: (value: number) => string
}

export const TRADITIONAL_TREND_METRICS: Record<
  TraditionalTrendMetric,
  TraditionalTrendMetricDefinition
> = {
  'score-per-18': {
    label: 'Scoring average',
    detail: 'Score per 18',
    group: 'Scoring',
    higherIsBetter: false,
    format: (value) => value.toFixed(1),
  },
  'score-to-par-per-18': {
    label: 'Score to par',
    detail: 'To par per 18',
    group: 'Scoring',
    higherIsBetter: false,
    format: formatSigned,
  },
  fairways: {
    label: 'Fairways hit',
    detail: 'Fairways hit percentage',
    group: 'Driving',
    higherIsBetter: true,
    format: formatPercent,
  },
  gir: {
    label: 'Greens in regulation',
    detail: 'GIR percentage',
    group: 'Approach',
    higherIsBetter: true,
    format: formatPercent,
  },
  'putts-per-18': {
    label: 'Putting volume',
    detail: 'Putts per 18',
    group: 'Putting',
    higherIsBetter: false,
    format: (value) => value.toFixed(1),
  },
  'putts-per-gir': {
    label: 'Putts per GIR',
    detail: 'Putts on GIR holes',
    group: 'Putting',
    higherIsBetter: false,
    format: (value) => value.toFixed(2),
  },
  scrambling: {
    label: 'Scrambling',
    detail: 'Scrambling percentage',
    group: 'Short game',
    higherIsBetter: true,
    format: formatPercent,
  },
  'up-and-downs': {
    label: 'Up and downs',
    detail: 'Up-and-down percentage',
    group: 'Short game',
    higherIsBetter: true,
    format: formatPercent,
  },
  'sand-saves': {
    label: 'Sand saves',
    detail: 'Estimated greenside sand-save percentage',
    group: 'Short game',
    higherIsBetter: true,
    format: formatPercent,
  },
  'penalties-per-18': {
    label: 'Penalty strokes',
    detail: 'Penalty strokes per 18',
    group: 'Scoring',
    higherIsBetter: false,
    format: (value) => value.toFixed(1),
  },
  'one-putts': {
    label: 'One-putt holes',
    detail: 'One-putt percentage',
    group: 'Putting',
    higherIsBetter: true,
    format: formatPercent,
  },
  'three-putts': {
    label: 'Three-putt holes',
    detail: 'Three-putt percentage',
    group: 'Putting',
    higherIsBetter: false,
    format: formatPercent,
  },
  'approach-proximity': {
    label: 'Approach proximity',
    detail: 'Average proximity in feet',
    group: 'Approach',
    higherIsBetter: false,
    format: (value) => `${value.toFixed(1)} ft`,
  },
}

interface HoleStats {
  score: number
  putts: number
  greenInRegulation: boolean
}

export function calculateTraditionalStats(rounds: Round[]): TraditionalStats {
  const stats: TraditionalStats = {
    rounds: 0,
    holesPlayed: 0,
    totalStrokes: 0,
    totalPar: 0,
    scoreToPar: 0,
    penaltyStrokes: 0,
    fairways: { made: 0, opportunities: 0 },
    greensInRegulation: { made: 0, opportunities: 0 },
    putts: 0,
    puttsPerHole: null,
    puttsOnGreensInRegulation: 0,
    puttsPerGreenInRegulation: null,
    onePutts: 0,
    threePutts: 0,
    scrambling: { made: 0, opportunities: 0 },
    upAndDowns: { made: 0, opportunities: 0 },
    sandSaves: { made: 0, opportunities: 0 },
    approachProximityFeet: null,
    approachProximityShots: 0,
    scoring: {
      eaglesOrBetter: 0,
      birdies: 0,
      pars: 0,
      bogeys: 0,
      doubleBogeysOrWorse: 0,
    },
    parScoring: {
      3: { holes: 0, strokes: 0, average: null },
      4: { holes: 0, strokes: 0, average: null },
      5: { holes: 0, strokes: 0, average: null },
    },
  }

  let totalApproachProximity = 0

  for (const round of rounds) {
    let hasCompletedHole = false
    for (const hole of round.holes) {
      const holeStats = calculateCompletedHole(hole)
      if (!holeStats) continue
      hasCompletedHole = true

      stats.holesPlayed += 1
      stats.totalStrokes += holeStats.score
      stats.totalPar += hole.par
      stats.penaltyStrokes += hole.shots.reduce(
        (sum, shot) => sum + shot.penaltyStrokes,
        0,
      )
      stats.putts += holeStats.putts
      if (holeStats.putts === 1) stats.onePutts += 1
      if (holeStats.putts >= 3) stats.threePutts += 1

      const scoreToPar = holeStats.score - hole.par
      if (scoreToPar <= -2) stats.scoring.eaglesOrBetter += 1
      else if (scoreToPar === -1) stats.scoring.birdies += 1
      else if (scoreToPar === 0) stats.scoring.pars += 1
      else if (scoreToPar === 1) stats.scoring.bogeys += 1
      else stats.scoring.doubleBogeysOrWorse += 1

      if (hole.par === 3 || hole.par === 4 || hole.par === 5) {
        stats.parScoring[hole.par].holes += 1
        stats.parScoring[hole.par].strokes += holeStats.score
      }

      if (hole.par >= 4) {
        stats.fairways.opportunities += 1
        const teeShot = hole.shots[0]
        const teeFinish = teeShot?.finish.lie
        if (
          teeShot?.penaltyStrokes === 0 &&
          (teeFinish === 'fairway' || teeFinish === 'green' || teeFinish === 'holed')
        ) {
          stats.fairways.made += 1
        }
      }

      stats.greensInRegulation.opportunities += 1
      if (holeStats.greenInRegulation) {
        stats.greensInRegulation.made += 1
        stats.puttsOnGreensInRegulation += holeStats.putts
      } else {
        stats.scrambling.opportunities += 1
        if (holeStats.score <= hole.par) stats.scrambling.made += 1
      }

      const upAndDownIndex = hole.shots.findIndex(
        (shot) =>
          shot.start.unit === 'yards' &&
          shot.start.distance <= 30 &&
          ['fairway', 'rough', 'sand'].includes(shot.start.lie),
      )
      if (upAndDownIndex >= 0) {
        stats.upAndDowns.opportunities += 1
        if (strokesFrom(hole, upAndDownIndex) <= 2) stats.upAndDowns.made += 1
      }

      const sandIndex = hole.shots.findIndex(
        (shot) =>
          shot.start.lie === 'sand' &&
          shot.start.unit === 'yards' &&
          shot.start.distance <= 30,
      )
      if (sandIndex >= 0) {
        stats.sandSaves.opportunities += 1
        if (strokesFrom(hole, sandIndex) <= 2) stats.sandSaves.made += 1
      }

      hole.shots.forEach((shot, shotIndex) => {
        if (
          shotCategory(shot, shotIndex, hole.par) === 'approach' &&
          (shot.finish.lie === 'green' || shot.finish.lie === 'holed')
        ) {
          totalApproachProximity += shot.finish.distance
          stats.approachProximityShots += 1
        }
      })
    }
    if (hasCompletedHole) stats.rounds += 1
  }

  stats.scoreToPar = stats.totalStrokes - stats.totalPar
  stats.puttsPerHole =
    stats.holesPlayed > 0 ? stats.putts / stats.holesPlayed : null
  stats.puttsPerGreenInRegulation =
    stats.greensInRegulation.made > 0
      ? stats.puttsOnGreensInRegulation / stats.greensInRegulation.made
      : null
  stats.approachProximityFeet =
    stats.approachProximityShots > 0
      ? totalApproachProximity / stats.approachProximityShots
      : null

  for (const metric of Object.values(stats.parScoring)) {
    metric.average = metric.holes > 0 ? metric.strokes / metric.holes : null
  }

  return stats
}

export function traditionalTrendValue(
  round: Round,
  metric: TraditionalTrendMetric,
): number | null {
  return traditionalMetricValue(calculateTraditionalStats([round]), metric)
}

export function traditionalTrendReference(
  rounds: Round[],
  metric: TraditionalTrendMetric,
): number | null {
  return traditionalMetricValue(calculateTraditionalStats(rounds), metric)
}

function traditionalMetricValue(
  stats: TraditionalStats,
  metric: TraditionalTrendMetric,
): number | null {
  if (stats.holesPlayed === 0) return null
  const per18 = (value: number) => (value / stats.holesPlayed) * 18
  const percentage = (value: CountMetric) =>
    value.opportunities > 0 ? (value.made / value.opportunities) * 100 : null

  switch (metric) {
    case 'score-per-18':
      return per18(stats.totalStrokes)
    case 'score-to-par-per-18':
      return per18(stats.scoreToPar)
    case 'fairways':
      return percentage(stats.fairways)
    case 'gir':
      return percentage(stats.greensInRegulation)
    case 'putts-per-18':
      return per18(stats.putts)
    case 'putts-per-gir':
      return stats.puttsPerGreenInRegulation
    case 'scrambling':
      return percentage(stats.scrambling)
    case 'up-and-downs':
      return percentage(stats.upAndDowns)
    case 'sand-saves':
      return percentage(stats.sandSaves)
    case 'penalties-per-18':
      return per18(stats.penaltyStrokes)
    case 'one-putts':
      return (stats.onePutts / stats.holesPlayed) * 100
    case 'three-putts':
      return (stats.threePutts / stats.holesPlayed) * 100
    case 'approach-proximity':
      return stats.approachProximityFeet
  }
}

function calculateCompletedHole(hole: Hole): HoleStats | null {
  if (hole.shots.at(-1)?.finish.lie !== 'holed') return null

  let strokesBeforeShot = 0
  let greenReachedAt: number | null = null
  let putts = 0
  for (const shot of hole.shots) {
    if (greenReachedAt === null && shot.start.lie === 'green') {
      greenReachedAt = strokesBeforeShot
    }
    if (shot.start.lie === 'green') putts += 1
    strokesBeforeShot += 1 + shot.penaltyStrokes
    if (
      greenReachedAt === null &&
      (shot.finish.lie === 'green' || shot.finish.lie === 'holed')
    ) {
      greenReachedAt = strokesBeforeShot
    }
  }

  return {
    score: strokesBeforeShot,
    putts,
    greenInRegulation:
      greenReachedAt !== null && greenReachedAt <= Math.max(1, hole.par - 2),
  }
}

function strokesFrom(hole: Hole, shotIndex: number): number {
  return hole.shots
    .slice(shotIndex)
    .reduce((sum, shot) => sum + 1 + shot.penaltyStrokes, 0)
}

function formatPercent(value: number): string {
  return `${value.toFixed(0)}%`
}

function formatSigned(value: number): string {
  if (Math.abs(value) < 0.05) return 'E'
  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1)
}
