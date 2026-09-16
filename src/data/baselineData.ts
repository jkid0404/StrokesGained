import puttBaselineCsv from './putt_baseline.csv?raw'
import shotBaselineCsv from './shot_baseline.csv?raw'

export interface BaselineAnchor {
  distance: number
  expected: number
}

type ShotLie = 'tee' | 'fairway' | 'rough' | 'sand'

const shotColumns: Record<ShotLie, number> = {
  tee: 1,
  fairway: 2,
  rough: 3,
  sand: 4,
}

export const KAGGLE_BASELINES: Record<ShotLie | 'green', BaselineAnchor[]> = {
  tee: parseColumn(shotBaselineCsv, shotColumns.tee),
  fairway: parseColumn(shotBaselineCsv, shotColumns.fairway),
  rough: parseColumn(shotBaselineCsv, shotColumns.rough),
  sand: parseColumn(shotBaselineCsv, shotColumns.sand),
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
