import {
  buildStrokesGainedSummary,
  type StrokesGainedSummary,
} from './analytics'
import {
  calculateRound,
  calculateShot,
  courseKey,
  type CourseTemplate,
  type Hole,
  type Round,
  type ShotCategory,
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
  strokesGainedCategories: Record<ShotCategory, number | null>
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
  strokesGainedSummary: StrokesGainedSummary
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
  strokesGainedCategoryTotals: Record<ShotCategory, number>
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
        strokesGainedCategoryTotals: categoryRecord(0),
        fairways: { made: 0, opportunities: 0 },
        greensInRegulation: { made: 0, opportunities: 0 },
        putts: 0,
        penalties: 0,
      }
      const strokesGained = calculateHoleStrokesGained(hole)

      group.pars.push(hole.par)
      group.scores.push(stats.totalStrokes)
      group.scoreToPar.push(stats.scoreToPar)
      if (strokesGained !== null) {
        group.strokesGained.push(strokesGained.total)
        for (const category of Object.keys(
          strokesGained.categories,
        ) as ShotCategory[]) {
          group.strokesGainedCategoryTotals[category] +=
            strokesGained.categories[category].total
        }
      }
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
    strokesGainedSummary: buildStrokesGainedSummary(matchingRounds),
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
    strokesGainedCategories: Object.fromEntries(
      (Object.keys(group.strokesGainedCategoryTotals) as ShotCategory[]).map(
        (category) => [
          category,
          group.strokesGained.length
            ? group.strokesGainedCategoryTotals[category] /
              group.strokesGained.length
            : null,
        ],
      ),
    ) as Record<ShotCategory, number | null>,
    supportedStrokesGainedRounds: group.strokesGained.length,
    fairways: group.fairways,
    greensInRegulation: group.greensInRegulation,
    averagePutts: group.putts / group.scores.length,
    averagePenalties: group.penalties / group.scores.length,
    established: group.scores.length >= 3,
  }
}

function calculateHoleStrokesGained(hole: Hole): {
  total: number
  categories: Record<ShotCategory, { total: number; shots: number }>
} | null {
  const values = hole.shots.map((shot, index) =>
    calculateShot(shot, index, hole.par),
  )
  if (values.some((value) => value.strokesGained === null)) return null
  const categories = {
    'off-the-tee': { total: 0, shots: 0 },
    approach: { total: 0, shots: 0 },
    'around-the-green': { total: 0, shots: 0 },
    putting: { total: 0, shots: 0 },
  } satisfies Record<ShotCategory, { total: number; shots: number }>

  for (const value of values) {
    categories[value.category].total += value.strokesGained ?? 0
    categories[value.category].shots += 1
  }

  return {
    total: values.reduce(
      (total, value) => total + (value.strokesGained ?? 0),
      0,
    ),
    categories,
  }
}

function addCountMetric(target: CountMetric, value: CountMetric): void {
  target.made += value.made
  target.opportunities += value.opportunities
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

function categoryRecord<T>(value: T): Record<ShotCategory, T> {
  return {
    'off-the-tee': value,
    approach: value,
    'around-the-green': value,
    putting: value,
  }
}
