import {
  KAGGLE_BASELINES,
  type BaselineAnchor,
} from './data/baselineData'

export type Lie =
  | 'tee'
  | 'fairway'
  | 'rough'
  | 'sand'
  | 'recovery'
  | 'green'
  | 'holed'

export type ShotCategory =
  | 'off-the-tee'
  | 'approach'
  | 'around-the-green'
  | 'putting'

export interface Position {
  lie: Lie
  distance: number
  unit: 'yards' | 'feet'
}

export interface Shot {
  id: string
  start: Position
  finish: Position
  penaltyStrokes: number
  club?: string
  note?: string
}

export interface Hole {
  number: number
  par: number
  yardage: number
  shots: Shot[]
}

export interface Round {
  id: string
  courseName: string
  teeName?: string
  playedOn: string
  createdAt: string
  status: 'draft' | 'complete'
  holes: Hole[]
  benchmarkVersion: typeof BENCHMARK_VERSION
}

export interface CourseTemplate {
  key: string
  name: string
  teeName: string
  holes: Record<number, Pick<Hole, 'par' | 'yardage'>>
}

export function courseKey(name: string, teeName = 'Unspecified tees'): string {
  return `${name.trim().toLocaleLowerCase()}::${teeName.trim().toLocaleLowerCase()}`
}

export interface ShotResult {
  shot: Shot
  category: ShotCategory
  expectedStart: number | null
  expectedFinish: number | null
  strokesGained: number | null
  error?: string
}

export interface CategoryMetric {
  total: number
  shots: number
  perShot: number
}

export interface RoundMetrics {
  totalStrokes: number
  penaltyStrokes: number
  completedHoles: number
  totalStrokesGained: number | null
  strokesGainedPer18: number | null
  supportedShots: number
  totalShots: number
  categories: Record<ShotCategory, CategoryMetric>
}

export interface PersonalBaseline {
  status: 'unavailable' | 'provisional' | 'established'
  includedRounds: number
  averageSgPer18: number | null
  medianSgPer18: number | null
  standardDeviation: number | null
  categoryPerShot: Partial<Record<ShotCategory, number>>
}

export interface CumulativeMetrics {
  versusPgaTour: number | null
  versusPersonalAverage: number | null
  pgaRoundCount: number
  personalRoundCount: number
}

export const BENCHMARK_VERSION = 'kaggle-evancallaghan-v1-2023'

export const CLUB_OPTIONS = [
  'Driver',
  '3 wood',
  '5 wood',
  '7 wood',
  '2 hybrid',
  '3 hybrid',
  '4 hybrid',
  'Driving iron',
  '3 iron',
  '4 iron',
  '5 iron',
  '6 iron',
  '7 iron',
  '8 iron',
  '9 iron',
  'Pitching wedge',
  'Gap wedge',
  'Sand wedge',
  'Lob wedge',
  'Putter',
] as const

export function buildHoleSequence(count: 9 | 18, startingHole: number): Hole[] {
  const normalizedStart = Math.min(18, Math.max(1, Math.round(startingHole)))
  const nineHoleStart = normalizedStart <= 9 ? 1 : 10
  const sequence = Array.from({ length: count }, (_, index) => {
    const number =
      count === 18
        ? ((normalizedStart - 1 + index) % 18) + 1
        : nineHoleStart + ((normalizedStart - nineHoleStart + index) % 9)

    return { number, par: 0, yardage: 0, shots: [] }
  })

  return sequence
}

export function buildCourseTemplates(rounds: Round[]): CourseTemplate[] {
  const templates = new Map<string, CourseTemplate>()
  const newestFirst = [...rounds].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  for (const round of newestFirst) {
    const teeName = round.teeName?.trim() || 'Unspecified tees'
    const key = courseKey(round.courseName, teeName)
    if (!key) continue

    const template = templates.get(key) ?? {
      key,
      name: round.courseName.trim(),
      teeName,
      holes: {},
    }

    for (const hole of round.holes) {
      if (!template.holes[hole.number] && hole.par >= 3 && hole.yardage > 0) {
        template.holes[hole.number] = { par: hole.par, yardage: hole.yardage }
      }
    }

    templates.set(key, template)
  }

  return [...templates.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function mergeCourseTemplates(
  derived: CourseTemplate[],
  saved: CourseTemplate[],
): CourseTemplate[] {
  const merged = new Map(derived.map((course) => [course.key, course]))
  for (const course of saved) {
    const teeName = course.teeName?.trim() || 'Unspecified tees'
    const normalized = {
      ...course,
      teeName,
      key: courseKey(course.name, teeName),
    }
    merged.set(normalized.key, normalized)
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function excludeDeletedCourseTemplates(
  courses: CourseTemplate[],
  deletedKeys: string[],
): CourseTemplate[] {
  const deleted = new Set(deletedKeys)
  return courses.filter((course) => !deleted.has(course.key))
}

export const LIE_LABELS: Record<Lie, string> = {
  tee: 'Tee',
  fairway: 'Fairway',
  rough: 'Rough',
  sand: 'Sand',
  recovery: 'Recovery',
  green: 'Green',
  holed: 'Holed',
}

type SupportedBenchmarkLie = Exclude<Lie, 'holed' | 'recovery'>

const BENCHMARKS: Record<SupportedBenchmarkLie, BaselineAnchor[]> = KAGGLE_BASELINES

export function benchmarkRange(lie: Lie): string {
  if (lie === 'holed') return '0'
  if (lie === 'recovery') return 'unsupported'
  const anchors = BENCHMARKS[lie]
  const unit = lie === 'green' ? 'ft' : 'yd'
  return `${anchors[0].distance}-${anchors.at(-1)!.distance} ${unit}`
}

export function expectedStrokes(position: Position): number {
  if (position.lie === 'holed') return 0
  if (position.lie === 'recovery') {
    throw new Error('Recovery shots are not supported by the active benchmark.')
  }

  const expectedUnit = position.lie === 'green' ? 'feet' : 'yards'
  if (position.unit !== expectedUnit) {
    throw new Error(`${LIE_LABELS[position.lie]} distances must use ${expectedUnit}.`)
  }

  const anchors = BENCHMARKS[position.lie]
  const first = anchors[0]
  const last = anchors.at(-1)!
  if (position.distance < first.distance || position.distance > last.distance) {
    throw new Error(
      `${LIE_LABELS[position.lie]} supports ${benchmarkRange(position.lie)} in the active benchmark.`,
    )
  }

  const exact = anchors.find((anchor) => anchor.distance === position.distance)
  if (exact) return exact.expected

  const upperIndex = anchors.findIndex((anchor) => anchor.distance > position.distance)
  const lower = anchors[upperIndex - 1]
  const upper = anchors[upperIndex]
  const progress = (position.distance - lower.distance) / (upper.distance - lower.distance)
  return lower.expected + progress * (upper.expected - lower.expected)
}

export function shotCategory(shot: Shot, shotIndex: number, par: number): ShotCategory {
  if (shot.start.lie === 'green') return 'putting'
  if (shotIndex === 0 && shot.start.lie === 'tee' && par >= 4) return 'off-the-tee'
  if (shot.start.distance <= 30) return 'around-the-green'
  return 'approach'
}

export function defaultFinishLie(
  par: number,
  shotIndex: number,
  start: Position,
  mostRecentlySelectedLie: Lie,
): Lie {
  if (start.lie === 'green') return start.distance <= 8 ? 'holed' : 'green'
  if (start.lie === 'tee') return par === 3 ? 'green' : 'fairway'
  if ((par === 4 || par === 5) && shotIndex === 1) return 'green'
  return mostRecentlySelectedLie
}

export function defaultClub(
  start: Position,
  mostRecentTeeClub: string,
  mostRecentOtherClub: string,
): string {
  if (start.lie === 'green') return 'Putter'
  if (start.lie === 'tee') return mostRecentTeeClub
  return mostRecentOtherClub
}

export function defaultDistanceEntry(start: Position, finishLie: Lie): number {
  if (start.lie === 'green') return 10
  return finishLie === 'green' ? 10 : 100
}

export function calculateShot(shot: Shot, shotIndex: number, par: number): ShotResult {
  const category = shotCategory(shot, shotIndex, par)
  try {
    const expectedStart = expectedStrokes(shot.start)
    const expectedFinish = expectedStrokes(shot.finish)
    return {
      shot,
      category,
      expectedStart,
      expectedFinish,
      strokesGained: expectedStart - expectedFinish - 1 - shot.penaltyStrokes,
    }
  } catch (error) {
    return {
      shot,
      category,
      expectedStart: null,
      expectedFinish: null,
      strokesGained: null,
      error: error instanceof Error ? error.message : 'Unsupported benchmark input.',
    }
  }
}

export function calculateRound(round: Round): RoundMetrics {
  const categorySeed = (): CategoryMetric => ({ total: 0, shots: 0, perShot: 0 })
  const categories: RoundMetrics['categories'] = {
    'off-the-tee': categorySeed(),
    approach: categorySeed(),
    'around-the-green': categorySeed(),
    putting: categorySeed(),
  }

  let totalStrokes = 0
  let penaltyStrokes = 0
  let totalStrokesGained = 0
  let supportedShots = 0
  let totalShots = 0
  let completedHoles = 0

  for (const hole of round.holes) {
    const isComplete = hole.shots.at(-1)?.finish.lie === 'holed'
    if (isComplete) completedHoles += 1

    hole.shots.forEach((shot, index) => {
      totalShots += 1
      totalStrokes += 1 + shot.penaltyStrokes
      penaltyStrokes += shot.penaltyStrokes
      const result = calculateShot(shot, index, hole.par)
      if (result.strokesGained !== null) {
        supportedShots += 1
        totalStrokesGained += result.strokesGained
        categories[result.category].total += result.strokesGained
        categories[result.category].shots += 1
      }
    })
  }

  for (const metric of Object.values(categories)) {
    metric.perShot = metric.shots ? metric.total / metric.shots : 0
  }

  const hasCompleteCoverage = totalShots > 0 && supportedShots === totalShots
  const sg = hasCompleteCoverage ? totalStrokesGained : null

  return {
    totalStrokes,
    penaltyStrokes,
    completedHoles,
    totalStrokesGained: sg,
    strokesGainedPer18: sg !== null && completedHoles >= 9 ? (sg / completedHoles) * 18 : null,
    supportedShots,
    totalShots,
    categories,
  }
}

export function buildPersonalBaseline(rounds: Round[], beforeRound?: Round): PersonalBaseline {
  const eligible = rounds
    .filter((round) => round.status === 'complete' && round.id !== beforeRound?.id)
    .filter(
      (round) =>
        !beforeRound ||
        round.playedOn < beforeRound.playedOn ||
        (round.playedOn === beforeRound.playedOn && round.createdAt < beforeRound.createdAt),
    )
    .map((round) => ({ round, metrics: calculateRound(round) }))
    .filter(({ metrics }) => metrics.strokesGainedPer18 !== null)
    .sort((a, b) => b.round.playedOn.localeCompare(a.round.playedOn))
    .slice(0, 20)

  if (eligible.length < 5) {
    return {
      status: 'unavailable',
      includedRounds: eligible.length,
      averageSgPer18: null,
      medianSgPer18: null,
      standardDeviation: null,
      categoryPerShot: {},
    }

  }

  const values = eligible.map(({ metrics }) => metrics.strokesGainedPer18!)
  const average = mean(values)
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  const variance = mean(values.map((value) => (value - average) ** 2))

  const categoryPerShot: PersonalBaseline['categoryPerShot'] = {}
  for (const category of Object.keys(eligible[0].metrics.categories) as ShotCategory[]) {
    const total = eligible.reduce(
      (sum, item) => sum + item.metrics.categories[category].total,
      0,
    )
    const shots = eligible.reduce(
      (sum, item) => sum + item.metrics.categories[category].shots,
      0,
    )
    if (shots) categoryPerShot[category] = total / shots
  }

  return {
    status: eligible.length >= 10 ? 'established' : 'provisional',
    includedRounds: eligible.length,
    averageSgPer18: average,
    medianSgPer18: median,
    standardDeviation: Math.sqrt(variance),
    categoryPerShot,
  }
}

export function calculateCumulativeMetrics(rounds: Round[]): CumulativeMetrics {
  const completed = rounds
    .filter((round) => round.status === 'complete')
    .sort(
      (a, b) =>
        a.playedOn.localeCompare(b.playedOn) || a.createdAt.localeCompare(b.createdAt),
    )

  let versusPgaTour = 0
  let versusPersonalAverage = 0
  let pgaRoundCount = 0
  let personalRoundCount = 0

  for (const round of completed) {
    const metrics = calculateRound(round)
    if (metrics.totalStrokesGained !== null) {
      versusPgaTour += metrics.totalStrokesGained
      pgaRoundCount += 1
    }

    const baseline = buildPersonalBaseline(completed, round)
    if (metrics.strokesGainedPer18 !== null && baseline.averageSgPer18 !== null) {
      const differencePer18 = metrics.strokesGainedPer18 - baseline.averageSgPer18
      versusPersonalAverage += (differencePer18 * metrics.completedHoles) / 18
      personalRoundCount += 1
    }
  }

  return {
    versusPgaTour: pgaRoundCount ? versusPgaTour : null,
    versusPersonalAverage: personalRoundCount ? versusPersonalAverage : null,
    pgaRoundCount,
    personalRoundCount,
  }
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function formatMetric(value: number | null, digits = 2): string {
  if (value === null) return 'N/A'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
}
