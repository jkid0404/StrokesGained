import {
  calculateRound,
  calculateShot,
  courseKey,
  type CourseTemplate,
  type Hole,
  type Round,
} from './domain'
import {
  calculateTraditionalStats,
  type CountMetric,
  type TraditionalStats,
} from './traditionalStats'

export interface CourseHoleInsight {
  holeNumber: number
  parLabel: string
  plays: number
  averageScore: number
  averageToPar: number
  averageStrokesGained: number | null
  supportedStrokesGainedRounds: number
  fairways: CountMetric
  greensInRegulation: CountMetric
  averagePutts: number
  averagePenalties: number
  established: boolean
}

export interface CourseInsights {
  course: CourseTemplate
  rounds: number
  latestPlayedOn: string | null
  bestScoreToParPer18: number | null
  averageStrokesGainedPer18: number | null
  traditionalStats: TraditionalStats
  holes: CourseHoleInsight[]
  troubleHoles: CourseHoleInsight[]
}

interface HoleAccumulator {
  holeNumber: number
  pars: number[]
  scores: number[]
  scoreToPar: number[]
  strokesGained: number[]
  fairways: CountMetric
  greensInRegulation: CountMetric
  putts: number
  penalties: number
}

export function buildCourseInsights(
  rounds: Round[],
  course: CourseTemplate,
): CourseInsights {
  const matchingKeys = new Set([course.key, ...(course.aliases ?? [])])
  const matchingRounds = rounds.filter(
    (round) =>
      round.status === 'complete' &&
      matchingKeys.has(
        courseKey(
          round.courseName,
          round.teeName?.trim() || 'Unspecified tees',
        ),
      ),
  )
  const holeGroups = new Map<number, HoleAccumulator>()

  for (const round of matchingRounds) {
    for (const hole of round.holes) {
      if (hole.shots.at(-1)?.finish.lie !== 'holed') continue
      const stats = calculateTraditionalStats([{ ...round, holes: [hole] }])
      const group = holeGroups.get(hole.number) ?? {
        holeNumber: hole.number,
        pars: [],
        scores: [],
        scoreToPar: [],
        strokesGained: [],
        fairways: { made: 0, opportunities: 0 },
        greensInRegulation: { made: 0, opportunities: 0 },
        putts: 0,
        penalties: 0,
      }
      const strokesGained = calculateHoleStrokesGained(hole)

      group.pars.push(hole.par)
      group.scores.push(stats.totalStrokes)
      group.scoreToPar.push(stats.scoreToPar)
      if (strokesGained !== null) group.strokesGained.push(strokesGained)
      addCountMetric(group.fairways, stats.fairways)
      addCountMetric(group.greensInRegulation, stats.greensInRegulation)
      group.putts += stats.putts
      group.penalties += stats.penaltyStrokes
      holeGroups.set(hole.number, group)
    }
  }

  const holes = [...holeGroups.values()]
    .map(toHoleInsight)
    .sort((a, b) => a.holeNumber - b.holeNumber)
  const roundSgValues = matchingRounds.flatMap((round) => {
    const metrics = calculateRound(round)
    return metrics.totalStrokesGained === null || metrics.completedHoles === 0
      ? []
      : [(metrics.totalStrokesGained / metrics.completedHoles) * 18]
  })
  const scoreToParValues = matchingRounds.flatMap((round) => {
    const stats = calculateTraditionalStats([round])
    return stats.holesPlayed
      ? [(stats.scoreToPar / stats.holesPlayed) * 18]
      : []
  })

  return {
    course,
    rounds: matchingRounds.length,
    latestPlayedOn:
      matchingRounds.reduce<string | null>(
        (latest, round) =>
          latest === null || round.playedOn > latest ? round.playedOn : latest,
        null,
      ),
    bestScoreToParPer18:
      scoreToParValues.length > 0 ? Math.min(...scoreToParValues) : null,
    averageStrokesGainedPer18:
      roundSgValues.length > 0 ? mean(roundSgValues) : null,
    traditionalStats: calculateTraditionalStats(matchingRounds),
    holes,
    troubleHoles: [...holes]
      .sort(
        (a, b) =>
          b.averageToPar - a.averageToPar ||
          (a.averageStrokesGained ?? Number.POSITIVE_INFINITY) -
            (b.averageStrokesGained ?? Number.POSITIVE_INFINITY),
      )
      .slice(0, 3),
  }
}

function toHoleInsight(group: HoleAccumulator): CourseHoleInsight {
  const uniquePars = [...new Set(group.pars)].sort((a, b) => a - b)
  return {
    holeNumber: group.holeNumber,
    parLabel:
      uniquePars.length === 1
        ? String(uniquePars[0])
        : `${uniquePars[0]}–${uniquePars.at(-1)}`,
    plays: group.scores.length,
    averageScore: mean(group.scores),
    averageToPar: mean(group.scoreToPar),
    averageStrokesGained:
      group.strokesGained.length > 0 ? mean(group.strokesGained) : null,
    supportedStrokesGainedRounds: group.strokesGained.length,
    fairways: group.fairways,
    greensInRegulation: group.greensInRegulation,
    averagePutts: group.putts / group.scores.length,
    averagePenalties: group.penalties / group.scores.length,
    established: group.scores.length >= 3,
  }
}

function calculateHoleStrokesGained(hole: Hole): number | null {
  const values = hole.shots.map((shot, index) =>
    calculateShot(shot, index, hole.par),
  )
  if (values.some((value) => value.strokesGained === null)) return null
  return values.reduce(
    (total, value) => total + (value.strokesGained ?? 0),
    0,
  )
}

function addCountMetric(target: CountMetric, value: CountMetric): void {
  target.made += value.made
  target.opportunities += value.opportunities
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}
