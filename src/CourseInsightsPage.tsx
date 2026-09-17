import { buildCourseInsights } from './courseInsights'
import { formatMetric, type CourseTemplate, type Round } from './domain'
import { TraditionalStatsPanel } from './TraditionalStatsPanel'
import { StrokesGainedSummary } from './StrokesGainedSummary'

export function CourseInsightsPage({
  course,
  rounds,
  onBack,
}: {
  course?: CourseTemplate
  rounds: Round[]
  onBack: () => void
}) {
  if (!course) {
    return (
      <section className="page narrow">
        <div className="empty-state">
          <h3>Course not found</h3>
          <button className="primary" type="button" onClick={onBack}>
            Back to courses
          </button>
        </div>
      </section>
    )
  }

  const insights = buildCourseInsights(rounds, course)

  return (
    <section className="page course-insights-page">
      <button className="text-button" type="button" onClick={onBack}>
        ← Back to courses
      </button>
      <div className="section-heading">
        <div>
          <span className="eyebrow">{course.teeName}</span>
          <h1 className="page-title">{course.name}</h1>
        </div>
        <span className="pill">
          {insights.rounds} completed round{insights.rounds === 1 ? '' : 's'}
        </span>
      </div>

      {insights.rounds === 0 ? (
        <div className="empty-state">
          <h3>No completed rounds yet</h3>
          <p>Complete a round from these tees to populate course and hole insights.</p>
        </div>
      ) : (
        <>
          <div className="course-insight-summary">
            <CourseInsightMetric
              detail="Across supported rounds"
              label="Average SG"
              value={formatMetric(insights.averageStrokesGainedPer18)}
            />
            <CourseInsightMetric
              detail="Normalized to 18 holes"
              label="Best to par"
              value={formatToPar(insights.bestScoreToParPer18)}
            />
            <CourseInsightMetric
              detail="Most recent completed round"
              label="Last played"
              value={insights.latestPlayedOn ?? 'N/A'}
            />
          </div>

          <StrokesGainedSummary
            context={`${course.name} · ${course.teeName}`}
            summary={insights.strokesGainedSummary}
          />

          <TraditionalStatsPanel
            context={`${course.name} · ${course.teeName}`}
            stats={insights.traditionalStats}
          />

          <div className="card trouble-holes-card">
            <div className="section-heading compact-heading">
              <div>
                <span className="eyebrow">Recurring challenges</span>
                <h2>Trouble holes</h2>
              </div>
            </div>
            <div className="trouble-hole-grid">
              {insights.troubleHoles.map((hole) => (
                <div className="trouble-hole" key={hole.holeNumber}>
                  <span>Hole {hole.holeNumber}</span>
                  <strong
                    className={hole.averageToPar <= 0 ? 'positive' : 'negative'}
                  >
                    {formatToPar(hole.averageToPar)}
                  </strong>
                  <small>
                    {hole.averageScore.toFixed(2)} avg score · {hole.plays} play
                    {hole.plays === 1 ? '' : 's'} ·{' '}
                    {hole.established ? 'Established' : 'Provisional'}
                  </small>
                </div>
              ))}
            </div>
          </div>

          <div className="card course-hole-card">
            <div className="section-heading compact-heading">
              <div>
                <span className="eyebrow">Hole-by-hole performance</span>
                <h2>Hole insights</h2>
              </div>
            </div>
            <div className="course-hole-scroll">
              <div className="course-hole-table">
                <div className="course-hole-row table-header">
                  <span>Hole</span>
                  <span>Plays</span>
                  <span>Avg score</span>
                  <span>To par</span>
                  <span>Avg SG</span>
                  <span>SG: Tee</span>
                  <span>SG: Approach</span>
                  <span>SG: Short</span>
                  <span>SG: Putting</span>
                  <span>Fairway</span>
                  <span>GIR</span>
                  <span>Putts</span>
                  <span>Penalties</span>
                </div>
                {insights.holes.map((hole) => (
                  <div className="course-hole-row" key={hole.holeNumber}>
                    <span>
                      <strong>{hole.holeNumber}</strong>
                      <small>Par {hole.parLabel}</small>
                    </span>
                    <span>{hole.plays}</span>
                    <strong>{hole.averageScore.toFixed(2)}</strong>
                    <strong
                      className={hole.averageToPar <= 0 ? 'positive' : 'negative'}
                    >
                      {formatToPar(hole.averageToPar)}
                    </strong>
                    <strong
                      className={
                        hole.averageStrokesGained === null
                          ? 'neutral-metric'
                          : hole.averageStrokesGained >= 0
                            ? 'positive'
                            : 'negative'
                      }
                    >
                      {formatMetric(hole.averageStrokesGained)}
                    </strong>
                    <CategoryMetric value={hole.strokesGainedCategories['off-the-tee']} />
                    <CategoryMetric value={hole.strokesGainedCategories.approach} />
                    <CategoryMetric
                      value={hole.strokesGainedCategories['around-the-green']}
                    />
                    <CategoryMetric value={hole.strokesGainedCategories.putting} />
                    <span>{formatCountMetric(hole.fairways)}</span>
                    <span>{formatCountMetric(hole.greensInRegulation)}</span>
                    <span>{hole.averagePutts.toFixed(2)}</span>
                    <span>{hole.averagePenalties.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function CategoryMetric({ value }: { value: number | null }) {
  return (
    <strong
      className={
        value === null
          ? 'neutral-metric'
          : value >= 0
            ? 'positive'
            : 'negative'
      }
    >
      {formatMetric(value)}
    </strong>
  )
}

function CourseInsightMetric({
  detail,
  label,
  value,
}: {
  detail: string
  label: string
  value: string
}) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

function formatCountMetric(metric: {
  made: number
  opportunities: number
}): string {
  if (!metric.opportunities) return 'N/A'
  return `${Math.round((metric.made / metric.opportunities) * 100)}%`
}

function formatToPar(value: number | null): string {
  if (value === null) return 'N/A'
  if (Math.abs(value) < 0.05) return 'E'
  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1)
}
