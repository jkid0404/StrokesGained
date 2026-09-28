import { useMemo, useState, type ReactNode } from 'react'
import {
  buildClubAnalytics,
  buildStrokesGainedSummary,
  buildTrendPoints,
  filterTrendRounds,
  personalTrendReference,
  type RoundLengthFilter,
  type TrendCategory,
  type TrendPoint,
} from './analytics'
import {
  formatMetric,
  type Round,
  type ShotCategory,
} from './domain'
import {
  calculateTraditionalStats,
  traditionalTrendReference,
  traditionalTrendValue,
  TRADITIONAL_TREND_METRICS,
  type TraditionalTrendMetric,
} from './traditionalStats'
import { TraditionalStatsPanel } from './TraditionalStatsPanel'
import { StrokesGainedSummary } from './StrokesGainedSummary'

const CATEGORY_LABELS: Record<ShotCategory, string> = {
  'off-the-tee': 'Off the tee',
  approach: 'Approach',
  recovery: 'Recovery',
  'around-the-green': 'Around the green',
  putting: 'Putting',
}

const WINDOW_OPTIONS = [5, 10, 20, 'all'] as const
type TrendWindow = (typeof WINDOW_OPTIONS)[number]
type TrendMetricSelection =
  | `sg:${TrendCategory}`
  | `traditional:${TraditionalTrendMetric}`

const SG_METRICS: Array<{
  key: TrendMetricSelection
  label: string
}> = [
  { key: 'sg:total', label: 'Total strokes gained' },
  ...(
    Object.keys(CATEGORY_LABELS) as ShotCategory[]
  ).map((category) => ({
    key: `sg:${category}` as TrendMetricSelection,
    label: CATEGORY_LABELS[category],
  })),
]
const TRADITIONAL_METRIC_GROUPS = [
  'Scoring',
  'Driving',
  'Approach',
  'Short game',
  'Putting',
] as const
const PERCENTAGE_TREND_METRICS = new Set<TraditionalTrendMetric>([
  'fairways',
  'gir',
  'scrambling',
  'up-and-downs',
  'sand-saves',
  'one-putts',
  'three-putts',
])

export function Trends({
  clubs,
  rounds,
}: {
  clubs: string[]
  rounds: Round[]
}) {
  const [windowSize, setWindowSize] = useState<TrendWindow>(10)
  const [courseName, setCourseName] = useState('')
  const [teeName, setTeeName] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [roundLength, setRoundLength] = useState<RoundLengthFilter>('all')
  const [selectedMetric, setSelectedMetric] =
    useState<TrendMetricSelection>('sg:total')

  const completedRounds = useMemo(
    () => rounds.filter((round) => round.status === 'complete'),
    [rounds],
  )
  const courseNames = useMemo(
    () => [...new Set(completedRounds.map((round) => round.courseName))].sort(),
    [completedRounds],
  )
  const teeNames = useMemo(
    () =>
      [
        ...new Set(
          completedRounds
            .filter((round) => !courseName || round.courseName === courseName)
            .map((round) => round.teeName?.trim() || 'Unspecified tees'),
        ),
      ].sort(),
    [completedRounds, courseName],
  )

  const filteredRounds = useMemo(
    () =>
      filterTrendRounds(rounds, {
        courseName,
        teeName,
        fromDate,
        toDate,
        roundLength,
      }),
    [courseName, fromDate, roundLength, rounds, teeName, toDate],
  )
  const displayedRounds =
    windowSize === 'all' ? filteredRounds : filteredRounds.slice(-windowSize)
  const windowContext =
    windowSize === 'all'
      ? `All ${displayedRounds.length} matching round${
          displayedRounds.length === 1 ? '' : 's'
        }`
      : `Last ${displayedRounds.length} matching round${
          displayedRounds.length === 1 ? '' : 's'
        }`
  const strokesGainedSummary = buildStrokesGainedSummary(displayedRounds)
  const traditionalStats = calculateTraditionalStats(displayedRounds)
  const isStrokesGained = selectedMetric.startsWith('sg:')
  const sgCategory = isStrokesGained
    ? (selectedMetric.slice(3) as TrendCategory)
    : 'total'
  const selectedTraditionalMetric = isStrokesGained
    ? null
    : (selectedMetric.slice('traditional:'.length) as TraditionalTrendMetric)
  const traditionalDefinition = selectedTraditionalMetric
    ? TRADITIONAL_TREND_METRICS[selectedTraditionalMetric]
    : null
  const points = isStrokesGained
    ? buildTrendPoints(displayedRounds, sgCategory)
    : displayedRounds.map((round) => ({
        round,
        value: traditionalTrendValue(round, selectedTraditionalMetric!),
      }))
  const reference = isStrokesGained
    ? personalTrendReference(filteredRounds, sgCategory)
    : traditionalTrendReference(filteredRounds, selectedTraditionalMetric!)
  const values = points.flatMap((point) =>
    point.value === null ? [] : [point.value],
  )
  const higherIsBetter =
    isStrokesGained || Boolean(traditionalDefinition?.higherIsBetter)
  const average = isStrokesGained
    ? values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null
    : traditionalTrendReference(displayedRounds, selectedTraditionalMetric!)
  const best = values.length
    ? higherIsBetter
      ? Math.max(...values)
      : Math.min(...values)
    : null
  const metricDetail = isStrokesGained
    ? sgCategory === 'total'
      ? 'SG per 18'
      : 'SG per shot'
    : traditionalDefinition!.detail
  const metricLabel = isStrokesGained
    ? sgCategory === 'total'
      ? 'Total strokes gained'
      : CATEGORY_LABELS[sgCategory]
    : traditionalDefinition!.label
  const formatValue = isStrokesGained
    ? formatMetric
    : traditionalDefinition!.format
  const canBeNegative =
    isStrokesGained || selectedTraditionalMetric === 'score-to-par-per-18'
  const isPercentage =
    selectedTraditionalMetric !== null &&
    PERCENTAGE_TREND_METRICS.has(selectedTraditionalMetric)
  const clubCategory = isStrokesGained ? sgCategory : 'total'
  const clubMetrics = buildClubAnalytics(
    displayedRounds,
    clubCategory,
    clubs,
  )

  return (
    <section className="page trends-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Performance analytics</span>
          <h1 className="page-title">Trends</h1>
        </div>
        <span className="pill">{filteredRounds.length} matching rounds</span>
      </div>

      <div className="card trend-controls">
        <div className="trend-window-control">
          <span>Show rounds</span>
          <div className="segmented" aria-label="Number of rounds to chart">
            {WINDOW_OPTIONS.map((option) => (
              <button
                className={windowSize === option ? 'active' : ''}
                key={option}
                type="button"
                onClick={() => setWindowSize(option)}
              >
                {option === 'all' ? 'All' : option}
              </button>
            ))}
          </div>
        </div>

        <div className="trend-filter-grid">
          <label>
            Course
            <select
              value={courseName}
              onChange={(event) => {
                setCourseName(event.target.value)
                setTeeName('')
              }}
            >
              <option value="">All courses</option>
              {courseNames.map((course) => (
                <option value={course} key={course}>
                  {course}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tees
            <select value={teeName} onChange={(event) => setTeeName(event.target.value)}>
              <option value="">All tees</option>
              {teeNames.map((tee) => (
                <option value={tee} key={tee}>
                  {tee}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
            />
          </label>
          <label>
            Round length
            <select
              value={roundLength}
              onChange={(event) =>
                setRoundLength(event.target.value as RoundLengthFilter)
              }
            >
              <option value="all">9 and 18 holes</option>
              <option value="9">9 holes</option>
              <option value="18">18 holes</option>
            </select>
          </label>
        </div>
      </div>

      {displayedRounds.length === 0 ? (
        <div className="empty-state trend-empty">
          <h3>No matching completed rounds</h3>
          <p>Adjust the filters or complete another round to populate this chart.</p>
        </div>
      ) : (
        <>
          <div className="trend-summary-grid">
            <TrendMetric
              detail={metricDetail}
              formatValue={formatValue}
              label="Window average"
              neutral={!isStrokesGained}
              value={average}
            />
            <TrendMetric
              detail={metricDetail}
              formatValue={formatValue}
              label="Best round"
              neutral={!isStrokesGained}
              value={best}
            />
            <TrendMetric
              detail={
                isStrokesGained && reference === null
                  ? 'Needs 5 eligible rounds'
                  : metricDetail
              }
              formatValue={formatValue}
              label={isStrokesGained ? 'Personal reference' : 'Filtered average'}
              neutral={!isStrokesGained}
              value={reference}
            />
          </div>

          <TrendChart
            averageReference={average}
            emptyMessage={
              isStrokesGained
                ? undefined
                : 'The selected rounds do not contain opportunities for this traditional statistic.'
            }
            formatValue={formatValue}
            headerControl={
              <TrendMetricSelector
                selectedMetric={selectedMetric}
                onChange={setSelectedMetric}
              />
            }
            label={metricLabel}
            metricDetail={metricDetail}
            pointClass={(value) => {
              if (isStrokesGained) return value >= 0 ? 'positive' : 'negative'
              if (reference === null) return 'neutral'
              const isBetter = higherIsBetter
                ? value >= reference
                : value <= reference
              return isBetter ? 'positive' : 'negative'
            }}
            points={points}
            showPgaReference={isStrokesGained}
            symmetric={canBeNegative}
            tickStep={isPercentage ? 20 : undefined}
            zeroAtTop={selectedMetric === 'sg:total'}
            zeroBased={!canBeNegative}
          />

          <StrokesGainedSummary
            context={windowContext}
            showContextPill={false}
            summary={strokesGainedSummary}
          />

          <TraditionalStatsPanel
            averagesOnly
            showContextPill={false}
            showHeading={false}
            stats={traditionalStats}
          />

          <div className="card club-analytics-card">
            <div className="section-heading compact-heading">
              <div>
                <span className="eyebrow">Club analytics</span>
                <h2>Performance by club</h2>
              </div>
            </div>
            {clubMetrics.length === 0 ? (
              <p className="muted split-empty">
                Record clubs on shots to compare their strokes-gained performance.
              </p>
            ) : (
              <div className="club-analytics-table">
                <div className="club-analytics-row table-header">
                  <span>Club</span>
                  <span>Shots</span>
                  <span>SG / shot</span>
                </div>
                {clubMetrics.map((metric) => (
                  <div className="club-analytics-row" key={metric.key}>
                    <span>
                      <strong>{metric.club}</strong>
                      {metric.distanceBand && (
                        <small>{metric.distanceBand}</small>
                      )}
                    </span>
                    <span>{metric.shots}</span>
                    <strong
                      className={
                        metric.averageStrokesGained === null
                          ? 'neutral-metric'
                          : metric.averageStrokesGained >= 0
                            ? 'positive'
                            : 'negative'
                      }
                    >
                      {formatMetric(metric.averageStrokesGained)}
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function TrendMetricSelector({
  selectedMetric,
  onChange,
}: {
  selectedMetric: TrendMetricSelection
  onChange: (metric: TrendMetricSelection) => void
}) {
  return (
    <label className="trend-chart-selector">
      Metric
      <select
        value={selectedMetric}
        onChange={(event) =>
          onChange(event.target.value as TrendMetricSelection)
        }
      >
        <optgroup label="Strokes gained">
          {SG_METRICS.map((metric) => (
            <option value={metric.key} key={metric.key}>
              {metric.label}
            </option>
          ))}
        </optgroup>
        {TRADITIONAL_METRIC_GROUPS.map((group) => (
          <optgroup label={group} key={group}>
            {(
              Object.entries(TRADITIONAL_TREND_METRICS) as Array<
                [
                  TraditionalTrendMetric,
                  (typeof TRADITIONAL_TREND_METRICS)[TraditionalTrendMetric],
                ]
              >
            )
              .filter(([, definition]) => definition.group === group)
              .map(([key, definition]) => (
                <option value={`traditional:${key}`} key={key}>
                  {definition.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

function TrendMetric({
  formatValue = formatMetric,
  label,
  value,
  detail,
  neutral = false,
}: {
  formatValue?: (value: number) => string
  label: string
  value: number | null
  detail: string
  neutral?: boolean
}) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong
        className={
          value === null || neutral
            ? 'neutral-metric'
            : value >= 0
              ? 'positive'
              : 'negative'
        }
      >
        {value === null ? 'N/A' : formatValue(value)}
      </strong>
      <small>{detail}</small>
    </div>
  )
}

function TrendChart({
  averageReference,
  emptyMessage = 'These rounds do not contain supported shots for the selected metric.',
  formatValue = formatMetric,
  headerControl,
  label,
  metricDetail,
  pointClass = (value) => (value >= 0 ? 'positive' : 'negative'),
  points,
  showPgaReference = true,
  symmetric = false,
  tickStep,
  zeroAtTop = false,
  zeroBased = false,
}: {
  averageReference: number | null
  emptyMessage?: string
  formatValue?: (value: number) => string
  headerControl?: ReactNode
  label: string
  metricDetail: string
  pointClass?: (value: number) => 'positive' | 'negative' | 'neutral'
  points: TrendPoint[]
  showPgaReference?: boolean
  symmetric?: boolean
  tickStep?: number
  zeroAtTop?: boolean
  zeroBased?: boolean
}) {
  const columnWidth = 14
  const columnGap = 2
  const columnPitch = columnWidth + columnGap
  const width = Math.max(680, points.length * columnPitch + 82)
  const height = 300
  const margin = { top: 28, right: 24, bottom: 24, left: 58 }
  const plotHeight = height - margin.top - margin.bottom
  const availableValues = points.flatMap((point) =>
    point.value === null ? [] : [point.value],
  )

  if (availableValues.length === 0) {
    return (
      <div className="card trend-chart-card">
        <div className="trend-chart-heading">
          <div>
            <span className="eyebrow">{label}</span>
            <h2>No supported values</h2>
          </div>
          {headerControl}
        </div>
        <p className="muted">{emptyMessage}</p>
      </div>
    )
  }

  const scaleValues = [
    ...availableValues,
    0,
    ...(averageReference === null ? [] : [averageReference]),
  ]
  const rawMin = Math.min(...scaleValues)
  const rawMax = Math.max(...scaleValues)
  const scale = chartScale(rawMin, rawMax, {
    symmetric,
    tickStep,
    zeroAtTop,
    zeroBased,
  })
  const { min, max, ticks } = scale
  const x = (index: number) =>
    margin.left + columnPitch * index + columnWidth / 2
  const y = (value: number) =>
    margin.top + ((max - value) / (max - min)) * plotHeight

  return (
    <div className="card trend-chart-card">
      <div className="trend-chart-heading">
        <div>
          <span className="eyebrow">{label}</span>
          <h2>{metricDetail}</h2>
        </div>
        <div className="trend-chart-tools">
          {headerControl}
          <div className="trend-legend" aria-label="Chart reference lines">
            <span className="trend-legend-series">Round</span>
            {showPgaReference && (
              <span className="trend-legend-pga">PGA Tour average</span>
            )}
            {averageReference !== null && (
              <span className="trend-legend-average">Window average</span>
            )}
          </div>
        </div>
      </div>
      <div className="trend-chart-scroll">
        <svg
          aria-label={`${label} over ${points.length} rounds`}
          className="trend-chart"
          role="img"
          style={{ minWidth: `${width}px` }}
          viewBox={`0 0 ${width} ${height}`}
        >
          <title>
            {label} over {points.length} matching rounds
          </title>
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className="trend-grid-line"
                x1={margin.left}
                x2={width - margin.right}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text className="trend-axis-label" x={margin.left - 10} y={y(tick) + 4}>
                {tick === 0 ? (tickStep === 20 ? '0%' : '0') : formatValue(tick)}
              </text>
            </g>
          ))}

          {showPgaReference && (
            <line
              className="trend-reference-line pga"
              x1={margin.left}
              x2={width - margin.right}
              y1={y(0)}
              y2={y(0)}
            />
          )}
          {averageReference !== null && (
            <line
              className="trend-reference-line average"
              x1={margin.left}
              x2={width - margin.right}
              y1={y(averageReference)}
              y2={y(averageReference)}
            />
          )}

          {points.map((point, index) => (
            <g key={point.round.id}>
              {point.value !== null && (
                <rect
                  className={`trend-bar ${pointClass(point.value)}`}
                  height={Math.max(1, Math.abs(y(point.value) - y(0)))}
                  width={columnWidth}
                  x={x(index) - columnWidth / 2}
                  y={Math.min(y(point.value), y(0))}
                >
                  <title>
                    {point.round.courseName}, {point.round.playedOn}:{' '}
                    {formatValue(point.value)}
                  </title>
                </rect>
              )}
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}

function chartScale(
  rawMin: number,
  rawMax: number,
  {
    symmetric,
    tickStep,
    zeroAtTop,
    zeroBased,
  }: {
    symmetric: boolean
    tickStep?: number
    zeroAtTop: boolean
    zeroBased: boolean
  },
): { min: number; max: number; ticks: number[] } {
  if (zeroAtTop && rawMax <= 0) {
    const step = niceStep(Math.abs(rawMin) / 4)
    const min = -Math.max(step, Math.ceil(Math.abs(rawMin) / step) * step)
    const intervalCount = Math.round(Math.abs(min) / step)
    return {
      min,
      max: 0,
      ticks: Array.from(
        { length: intervalCount + 1 },
        (_, index) => normalizeTick(-index * step),
      ),
    }
  }

  if (symmetric) {
    const step = niceStep(Math.max(Math.abs(rawMin), Math.abs(rawMax)) / 2)
    const max = step * 2
    return {
      min: -max,
      max,
      ticks: [max, step, 0, -step, -max],
    }
  }

  if (zeroBased) {
    const step = tickStep ?? niceStep(rawMax / 5)
    const max = Math.max(step, Math.ceil(rawMax / step) * step)
    const intervalCount = Math.round(max / step)
    return {
      min: 0,
      max,
      ticks: Array.from(
        { length: intervalCount + 1 },
        (_, index) => normalizeTick(max - index * step),
      ),
    }
  }

  const step = niceStep((rawMax - rawMin || 1) / 4)
  const min = Math.floor(rawMin / step) * step
  const max = Math.ceil(rawMax / step) * step
  const intervalCount = Math.round((max - min) / step)
  return {
    min,
    max,
    ticks: Array.from(
      { length: intervalCount + 1 },
      (_, index) => normalizeTick(max - index * step),
    ),
  }
}

function niceStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const multiplier =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return multiplier * magnitude
}

function normalizeTick(value: number): number {
  return Number(value.toPrecision(12))
}
