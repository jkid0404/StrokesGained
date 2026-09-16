import { useMemo, useState } from 'react'
import {
  buildClubAnalytics,
  buildCourseSplits,
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
import { calculateTraditionalStats } from './traditionalStats'
import { TraditionalStatsPanel } from './TraditionalStatsPanel'

const CATEGORY_LABELS: Record<ShotCategory, string> = {
  'off-the-tee': 'Off the tee',
  approach: 'Approach',
  'around-the-green': 'Around the green',
  putting: 'Putting',
}

const WINDOW_OPTIONS = [5, 10, 20] as const

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
  const [category, setCategory] = useState<TrendCategory>('total')

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
  const points = buildTrendPoints(displayedRounds, category)
  const personalReference = personalTrendReference(filteredRounds, category)
  const splits = buildCourseSplits(displayedRounds, category)
  const clubMetrics = buildClubAnalytics(displayedRounds, category, clubs)
  const traditionalStats = calculateTraditionalStats(displayedRounds)
  const values = points.flatMap((point) => (point.value === null ? [] : [point.value]))
  const average = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null
  const best = values.length ? Math.max(...values) : null
  const metricDetail = category === 'total' ? 'SG per 18' : 'SG per shot'
  const metricLabel =
    category === 'total' ? 'Total strokes gained' : CATEGORY_LABELS[category]

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
          <label>
            Category
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as TrendCategory)}
            >
              <option value="total">Total SG</option>
              {(Object.keys(CATEGORY_LABELS) as ShotCategory[]).map((item) => (
                <option value={item} key={item}>
                  {CATEGORY_LABELS[item]}
                </option>
              ))}
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
            <TrendMetric label="Average" value={average} detail={metricDetail} />
            <TrendMetric label="Best" value={best} detail={metricDetail} />
            <TrendMetric
              label="Personal reference"
              value={personalReference}
              detail={
                personalReference === null
                  ? 'Needs 5 eligible rounds'
                  : metricDetail
              }
            />
          </div>

          <TrendChart
            label={metricLabel}
            metricDetail={metricDetail}
            personalReference={personalReference}
            points={points}
          />

          <TraditionalStatsPanel
            context={`Last ${displayedRounds.length} matching round${
              displayedRounds.length === 1 ? '' : 's'
            }`}
            stats={traditionalStats}
          />

          <div className="card course-splits-card">
            <div className="section-heading compact-heading">
              <div>
                <span className="eyebrow">Course and tee comparison</span>
                <h2>Splits</h2>
              </div>
              <span className="pill">Last {displayedRounds.length}</span>
            </div>
            {splits.length === 0 ? (
              <p className="muted split-empty">
                No supported {metricLabel.toLowerCase()} values are available.
              </p>
            ) : (
              <div className="course-split-table">
                <div className="course-split-row table-header">
                  <span>Course / tees</span>
                  <span>Rounds</span>
                  <span>Average</span>
                  <span>Best</span>
                </div>
                {splits.map((split) => (
                  <div className="course-split-row" key={split.key}>
                    <span>
                      <strong>{split.courseName}</strong>
                      <small>{split.teeName}</small>
                    </span>
                    <span>{split.rounds}</span>
                    <strong className={split.average >= 0 ? 'positive' : 'negative'}>
                      {formatMetric(split.average)}
                    </strong>
                    <strong className={split.best >= 0 ? 'positive' : 'negative'}>
                      {formatMetric(split.best)}
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card club-analytics-card">
            <div className="section-heading compact-heading">
              <div>
                <span className="eyebrow">Club analytics</span>
                <h2>Performance by club</h2>
              </div>
              <span className="pill">{CATEGORY_LABELS[category as ShotCategory] ?? 'All shots'}</span>
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
                      <small>
                        {metric.distanceBand && `${metric.distanceBand} · `}
                        {metric.shots < 5 ? 'Small sample' : 'Established sample'}
                      </small>
                    </span>
                    <span>{metric.shots}</span>
                    <span>
                      {metric.averageDistance === null || metric.distanceUnit === null
                        ? 'Mixed'
                        : `${metric.averageDistance.toFixed(0)} ${
                            metric.distanceUnit === 'feet' ? 'ft' : 'yd'
                          }`}
                    </span>
                    <strong
                      className={
                        metric.averageStrokesGained >= 0 ? 'positive' : 'negative'
                      }
                    >
                      {formatMetric(metric.averageStrokesGained)}
                    </strong>
                    <strong
                      className={
                        metric.totalStrokesGained >= 0 ? 'positive' : 'negative'
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

function TrendMetric({
  label,
  value,
  detail,
}: {
  label: string
  value: number | null
  detail: string
}) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong
        className={
          value === null ? 'neutral-metric' : value >= 0 ? 'positive' : 'negative'
        }
      >
        {formatMetric(value)}
      </strong>
      <small>{detail}</small>
    </div>
  )
}

function TrendChart({
  label,
  metricDetail,
  personalReference,
  points,
}: {
  label: string
  metricDetail: string
  personalReference: number | null
  points: TrendPoint[]
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
        </div>
        <p className="muted">
          These rounds do not contain supported shots for the selected metric.
        </p>
      </div>
    )
  }

  const scaleValues = [
    ...availableValues,
    0,
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
        <div className="trend-legend" aria-label="Chart reference lines">
          <span className="trend-legend-series">Round</span>
          <span className="trend-legend-pga">PGA Tour</span>
          {personalReference !== null && (
            <span className="trend-legend-personal">Your average</span>
          )}
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
                {tick.toFixed(1)}
              </text>
            </g>
          ))}

          <line
            className="trend-reference-line pga"
            x1={margin.left}
            x2={width - margin.right}
            y1={y(0)}
            y2={y(0)}
          />
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
                  className={point.value >= 0 ? 'trend-point positive' : 'trend-point negative'}
                  cx={x(index)}
                  cy={y(point.value)}
                  r="5"
                >
                  <title>
                    {point.round.courseName}, {point.round.playedOn}: {formatMetric(point.value)}
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
