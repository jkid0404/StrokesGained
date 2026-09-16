import {
  buildPersonalBaseline,
  calculateRound,
  courseKey,
  type Round,
  type ShotCategory,
} from './domain'

export type TrendCategory = 'total' | ShotCategory
export type RoundLengthFilter = 'all' | '9' | '18'

export interface TrendFilters {
  courseName: string
  teeName: string
  fromDate: string
  toDate: string
  roundLength: RoundLengthFilter
}

export interface TrendPoint {
  round: Round
  value: number | null
}

export interface CourseSplit {
  key: string
  courseName: string
  teeName: string
  rounds: number
  average: number
  best: number
}

export function filterTrendRounds(rounds: Round[], filters: TrendFilters): Round[] {
  return rounds
    .filter((round) => round.status === 'complete')
    .filter((round) => !filters.courseName || round.courseName === filters.courseName)
    .filter((round) => !filters.teeName || normalizedTeeName(round) === filters.teeName)
    .filter((round) => !filters.fromDate || round.playedOn >= filters.fromDate)
    .filter((round) => !filters.toDate || round.playedOn <= filters.toDate)
    .filter(
      (round) =>
        filters.roundLength === 'all' ||
        round.holes.length === Number(filters.roundLength),
    )
    .sort(
      (a, b) =>
        a.playedOn.localeCompare(b.playedOn) ||
        a.createdAt.localeCompare(b.createdAt),
    )
}

export function trendValue(round: Round, category: TrendCategory): number | null {
  const metrics = calculateRound(round)
  if (metrics.supportedShots !== metrics.totalShots) return null
  if (category === 'total') return metrics.strokesGainedPer18

  const metric = metrics.categories[category]
  return metric.shots ? metric.perShot : null
}

export function buildTrendPoints(
  rounds: Round[],
  category: TrendCategory,
): TrendPoint[] {
  return rounds.map((round) => ({ round, value: trendValue(round, category) }))
}

export function personalTrendReference(
  rounds: Round[],
  category: TrendCategory,
): number | null {
  const baseline = buildPersonalBaseline(rounds)
  if (category === 'total') return baseline.averageSgPer18
  return baseline.categoryPerShot[category] ?? null
}

export function buildCourseSplits(
  rounds: Round[],
  category: TrendCategory,
): CourseSplit[] {
  const groups = new Map<
    string,
    { courseName: string; teeName: string; values: number[] }
  >()

  for (const round of rounds) {
    const value = trendValue(round, category)
    if (value === null) continue

    const teeName = normalizedTeeName(round)
    const key = courseKey(round.courseName, teeName)
    const group = groups.get(key) ?? {
      courseName: round.courseName,
      teeName,
      values: [],
    }
    group.values.push(value)
    groups.set(key, group)
  }

  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      courseName: group.courseName,
      teeName: group.teeName,
      rounds: group.values.length,
      average: mean(group.values),
      best: Math.max(...group.values),
    }))
    .sort((a, b) => b.average - a.average || a.courseName.localeCompare(b.courseName))
}

function normalizedTeeName(round: Round): string {
  return round.teeName?.trim() || 'Unspecified tees'
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
