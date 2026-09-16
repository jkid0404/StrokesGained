import {
  buildPersonalBaseline,
  calculateRound,
  calculateShot,
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

export interface ClubMetric {
  key: string
  club: string
  distanceBand: string | null
  shots: number
  averageDistance: number | null
  distanceUnit: 'yards' | 'feet' | null
  averageStrokesGained: number | null
  totalStrokesGained: number | null
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

export function buildClubAnalytics(
  rounds: Round[],
  category: TrendCategory,
  clubOrder: readonly string[] = [],
): ClubMetric[] {
  const groups = new Map<
    string,
    {
      club: string
      distanceBand: string | null
      strokesGained: number[]
      distances: number[]
      units: Set<'yards' | 'feet'>
    }
  >()

  for (const club of clubOrder) {
    const trimmedClub = club.trim()
    if (!trimmedClub) continue
    const normalizedClub = trimmedClub.toLocaleLowerCase()
    for (const bucket of clubDistanceBucketsFor(normalizedClub)) {
      groups.set(`${normalizedClub}::${bucket.key}`, {
        club: trimmedClub,
        distanceBand: bucket.label,
        strokesGained: [],
        distances: [],
        units: new Set<'yards' | 'feet'>(),
      })
    }
  }

  for (const round of rounds) {
    for (const hole of round.holes) {
      hole.shots.forEach((shot, shotIndex) => {
        const club = shot.club?.trim()
        if (!club) return

        const result = calculateShot(shot, shotIndex, hole.par)
        if (result.strokesGained === null) return
        if (category !== 'total' && result.category !== category) return

        const normalizedClub = club.toLocaleLowerCase()
        const normalizedDistance = clubAnalyticsDistance(
          normalizedClub,
          shot.start.distance,
          shot.start.unit,
        )
        const bucket = clubDistanceBucket(
          normalizedClub,
          normalizedDistance.distance,
          normalizedDistance.unit,
        )
        const key = `${normalizedClub}::${bucket.key}`
        const group = groups.get(key) ?? {
          club,
          distanceBand: bucket.label,
          strokesGained: [],
          distances: [],
          units: new Set<'yards' | 'feet'>(),
        }
        group.strokesGained.push(result.strokesGained)
        group.distances.push(normalizedDistance.distance)
        group.units.add(normalizedDistance.unit)
        groups.set(key, group)
      })
    }
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const totalStrokesGained = group.strokesGained.reduce(
        (sum, value) => sum + value,
        0,
      )
      const shots = group.strokesGained.length
      const hasOneUnit = group.units.size === 1
      return {
        key,
        club: group.club,
        distanceBand: group.distanceBand,
        shots,
        averageDistance: shots > 0 && hasOneUnit ? mean(group.distances) : null,
        distanceUnit: shots > 0 && hasOneUnit ? [...group.units][0] : null,
        averageStrokesGained: shots > 0 ? totalStrokesGained / shots : null,
        totalStrokesGained: shots > 0 ? totalStrokesGained : null,
      }
    })
    .sort(
      (a, b) =>
        clubOrderIndex(a.club, clubOrder) - clubOrderIndex(b.club, clubOrder) ||
        a.club.localeCompare(b.club) ||
        clubBucketOrder(a.key) - clubBucketOrder(b.key),
    )
}

function clubDistanceBucketsFor(
  normalizedClub: string,
): Array<{ key: string; label: string | null }> {
  if (normalizedClub === 'putter') {
    return [
      { key: '0-6', label: '0–6 ft' },
      { key: '7-15', label: '7–15 ft' },
      { key: '16-30', label: '16–30 ft' },
      { key: '31-plus', label: '31+ ft' },
    ]
  }
  if (normalizedClub === '58 wedge') {
    return [
      { key: '0-30', label: '≤30 yd' },
      { key: '31-65', label: '31–65 yd' },
      { key: '66-plus', label: '66+ yd' },
    ]
  }
  return [{ key: 'all', label: null }]
}

function clubDistanceBucket(
  normalizedClub: string,
  distance: number,
  unit: 'yards' | 'feet',
): { key: string; label: string | null } {
  const displayedDistance = Math.round(distance)

  if (normalizedClub === 'putter') {
    if (displayedDistance <= 6) return { key: '0-6', label: '0–6 ft' }
    if (displayedDistance <= 15) return { key: '7-15', label: '7–15 ft' }
    if (displayedDistance <= 30) return { key: '16-30', label: '16–30 ft' }
    return { key: '31-plus', label: '31+ ft' }
  }

  if (normalizedClub === '58 wedge') {
    if (unit !== 'yards') return { key: 'other-unit', label: 'Other' }
    if (displayedDistance <= 30) return { key: '0-30', label: '≤30 yd' }
    if (displayedDistance <= 65) return { key: '31-65', label: '31–65 yd' }
    return { key: '66-plus', label: '66+ yd' }
  }

  return { key: 'all', label: null }
}

function clubAnalyticsDistance(
  normalizedClub: string,
  distance: number,
  unit: 'yards' | 'feet',
): { distance: number; unit: 'yards' | 'feet' } {
  if (normalizedClub === 'putter') {
    return {
      distance: unit === 'yards' ? distance * 3 : distance,
      unit: 'feet',
    }
  }
  return { distance, unit }
}

function clubOrderIndex(club: string, clubOrder: readonly string[]): number {
  if (club.toLocaleLowerCase() === 'putter') return Number.MAX_SAFE_INTEGER
  const index = clubOrder.findIndex(
    (option) => option.toLocaleLowerCase() === club.toLocaleLowerCase(),
  )
  return index >= 0 ? index : clubOrder.length
}

function clubBucketOrder(key: string): number {
  const band = key.slice(key.lastIndexOf('::') + 2)
  const orders: Record<string, number> = {
    '0-6': 0,
    '0-30': 0,
    '31-65': 1,
    '7-15': 1,
    '66-plus': 2,
    '16-30': 2,
    'other-unit': 3,
    '31-plus': 3,
    all: 0,
  }
  return orders[band] ?? 0
}

function normalizedTeeName(round: Round): string {
  return round.teeName?.trim() || 'Unspecified tees'
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
