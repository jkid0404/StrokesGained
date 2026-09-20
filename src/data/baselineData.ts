import puttBaselineCsv from './putt_baseline.csv?raw'
import shotBaselineCsv from './shot_baseline.csv?raw'

export interface BaselineAnchor {
  distance: number
  expected: number
}

type ShotLie = 'tee' | 'fairway' | 'rough' | 'sand' | 'recovery'

const shotColumns: Record<Exclude<ShotLie, 'recovery'>, number> = {
  tee: 1,
  fairway: 2,
  rough: 3,
  sand: 4,
}

// PGA Tour recovery values from Broadie's published expected-strokes table:
// https://pinflag.io/expected-strokes/recovery
const RECOVERY_BASELINE: BaselineAnchor[] = [
  { distance: 100, expected: 3.8 },
  { distance: 120, expected: 3.78 },
  { distance: 140, expected: 3.8 },
  { distance: 160, expected: 3.81 },
  { distance: 180, expected: 3.82 },
  { distance: 200, expected: 3.87 },
  { distance: 220, expected: 3.92 },
  { distance: 240, expected: 3.97 },
  { distance: 260, expected: 4.03 },
  { distance: 280, expected: 4.1 },
  { distance: 300, expected: 4.2 },
]

export const KAGGLE_BASELINES: Record<ShotLie | 'green', BaselineAnchor[]> = {
  tee: parseColumn(shotBaselineCsv, shotColumns.tee),
  fairway: parseColumn(shotBaselineCsv, shotColumns.fairway),
  rough: parseColumn(shotBaselineCsv, shotColumns.rough),
  sand: parseColumn(shotBaselineCsv, shotColumns.sand),
  recovery: RECOVERY_BASELINE,
  green: parseColumn(puttBaselineCsv, 1),
}

function parseColumn(csv: string, valueColumn: number): BaselineAnchor[] {
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .flatMap((line) => {
      const columns = line.split(',')
      const distance = Number(columns[0])
      const expected = Number(columns[valueColumn])
      return Number.isFinite(distance) && Number.isFinite(expected) && columns[valueColumn] !== ''
        ? [{ distance, expected }]
        : []
    })
}
