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
  'around-the-green': 'Around the green',
  putting: 'Putting',
}

const WINDOW_OPTIONS = [5, 10, 20] as const
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

export function Trends({
  clubs,
  rounds,
}: {
  clubs: string[]
  rounds: Round[]
}) {
  const [windowSize, setWindowSize] = useState<(typeof WINDOW_OPTIONS)[number]>(10)
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
  const displayedRounds = filteredRounds.slice(-windowSize)
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
          <span>Show last</span>
          <div className="segmented" aria-label="Number of rounds to chart">
            {WINDOW_OPTIONS.map((option) => (
              <button
                className={windowSize === option ? 'active' : ''}
                key={option}
                type="button"
                onClick={() => setWindowSize(option)}
              >
                {option}
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
            personalReference={reference}
            personalReferenceLabel={
              isStrokesGained ? 'Your average' : 'Filtered average'
            }
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
          />

          <StrokesGainedSummary
            context={`Last ${displayedRounds.length} matching round${
              displayedRounds.length === 1 ? '' : 's'
            }`}
            summary={strokesGainedSummary}
          />

          <TraditionalStatsPanel
            context={`Last ${displayedRounds.length} matching round${
              displayedRounds.length === 1 ? '' : 's'
            }`}
            stats={traditionalStats}
          />

          <div className="card club-analytics-card">
            <div className="section-heading compact-heading">
              <div>
                <span className="eyebrow">Club analytics</span>
                <h2>Performance by club</h2>
              </div>
              <span className="pill">
                {clubCategory === 'total'
                  ? 'All shots'
                  : CATEGORY_LABELS[clubCategory]}
              </span>
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
                  <span>Avg start</span>
                  <span>SG / shot</span>
                  <span>Total SG</span>
                </div>
                {clubMetrics.map((metric) => (
                  <div className="club-analytics-row" key={metric.key}>
                    <span>
                      <strong>{metric.club}</strong>
                    </span>
                    <span>{metric.shots}</span>
                    <span>
                      {metric.averageDistance === null || metric.distanceUnit === null
                        ? 'N/A'
                        : `${metric.averageDistance.toFixed(0)} ${
                            metric.distanceUnit === 'feet' ? 'ft' : 'yd'
                          }`}
                    </span>
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
                    <strong
                      className={
                        metric.totalStrokesGained === null
                          ? 'neutral-metric'
                          : metric.totalStrokesGained >= 0
                            ? 'positive'
                            : 'negative'
                      }
                    >
                      {formatMetric(metric.totalStrokesGained)}
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
  emptyMessage = 'These rounds do not contain supported shots for the selected metric.',
  formatValue = formatMetric,
  headerControl,
  label,
  metricDetail,
  personalReference,
  personalReferenceLabel = 'Your average',
  pointClass = (value) => (value >= 0 ? 'positive' : 'negative'),
  points,
  showPgaReference = true,
}: {
  emptyMessage?: string
  formatValue?: (value: number) => string
  headerControl?: ReactNode
  label: string
  metricDetail: string
  personalReference: number | null
  personalReferenceLabel?: string
  pointClass?: (value: number) => 'positive' | 'negative' | 'neutral'
  points: TrendPoint[]
  showPgaReference?: boolean
}) {
  const width = 840
  const height = 330
  const margin = { top: 28, right: 24, bottom: 58, left: 58 }
  const plotWidth = width - margin.left - margin.right
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
    ...(showPgaReference ? [0] : []),
    ...(personalReference === null ? [] : [personalReference]),
  ]
  const rawMin = Math.min(...scaleValues)
  const rawMax = Math.max(...scaleValues)
  const rawRange = rawMax - rawMin || 1
  const padding = Math.max(0.1, rawRange * 0.15)
  const min = rawMin - padding
  const max = rawMax + padding
  const x = (index: number) =>
    points.length === 1
      ? margin.left + plotWidth / 2
      : margin.left + (index / (points.length - 1)) * plotWidth
  const y = (value: number) =>
    margin.top + ((max - value) / (max - min)) * plotHeight
  const ticks = Array.from({ length: 5 }, (_, index) => max - ((max - min) * index) / 4)
  const segments = buildLineSegments(points, x, y)
  const labelStep = Math.max(1, Math.ceil(points.length / 10))

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
              <span className="trend-legend-pga">PGA Tour</span>
            )}
            {personalReference !== null && (
              <span className="trend-legend-personal">
                {personalReferenceLabel}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="trend-chart-scroll">
        <svg
          aria-label={`${label} over ${points.length} rounds`}
          className="trend-chart"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <title>
            {label} over the last {points.length} matching rounds
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
                {formatValue(tick)}
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
          {personalReference !== null && (
            <line
              className="trend-reference-line personal"
              x1={margin.left}
              x2={width - margin.right}
              y1={y(personalReference)}
              y2={y(personalReference)}
            />
          )}

          {segments.map((segment, index) => (
            <polyline className="trend-series-line" key={index} points={segment} />
          ))}

          {points.map((point, index) => (
            <g key={point.round.id}>
              {point.value !== null && (
                <circle
                  className={`trend-point ${pointClass(point.value)}`}
                  cx={x(index)}
                  cy={y(point.value)}
                  r="5"
                >
                  <title>
                    {point.round.courseName}, {point.round.playedOn}:{' '}
                    {formatValue(point.value)}
                  </title>
                </circle>
              )}
              {(index % labelStep === 0 || index === points.length - 1) && (
                <text
                  className="trend-axis-label x-axis"
                  textAnchor="middle"
                  x={x(index)}
                  y={height - 25}
                >
                  {formatChartDate(point.round.playedOn)}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}

function buildLineSegments(
  points: TrendPoint[],
  x: (index: number) => number,
  y: (value: number) => number,
): string[] {
  const segments: string[] = []
  let current: string[] = []

  points.forEach((point, index) => {
    if (point.value === null) {
      if (current.length) segments.push(current.join(' '))
      current = []
      return
    }
    current.push(`${x(index)},${y(point.value)}`)
  })
  if (current.length) segments.push(current.join(' '))
  return segments
}

function formatChartDate(value: string): string {
  const [, month, day] = value.split('-')
  return `${Number(month)}/${Number(day)}`
}
