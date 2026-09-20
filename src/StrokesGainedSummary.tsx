import { formatMetric, type ShotCategory } from './domain'
import type { StrokesGainedSummary as StrokesGainedSummaryData } from './analytics'

const CATEGORY_LABELS: Record<ShotCategory, string> = {
  'off-the-tee': 'Off the tee',
  approach: 'Approach',
  recovery: 'Recovery',
  'around-the-green': 'Around the green',
  putting: 'Putting',
}

export function StrokesGainedSummary({
  context,
  showContextPill = true,
  summary,
}: {
  context: string
  showContextPill?: boolean
  summary: StrokesGainedSummaryData
}) {
  return (
    <div className="card strokes-gained-summary-card">
      <div className="section-heading compact-heading">
        <div>
          <span className="eyebrow">Strokes gained</span>
          <h2>Performance by category</h2>
        </div>
        {showContextPill && <span className="pill">{context}</span>}
      </div>
      <div className="strokes-gained-summary-grid">
        <StrokesGainedMetric
          detail={`${summary.supportedRounds} supported round${
            summary.supportedRounds === 1 ? '' : 's'
          } · SG per 18`}
          label="Total"
          value={summary.totalPer18}
        />
        {(Object.keys(CATEGORY_LABELS) as ShotCategory[]).map((category) => (
          <StrokesGainedMetric
            detail={`${summary.categories[category].shots} shot${
              summary.categories[category].shots === 1 ? '' : 's'
            } · SG per 18`}
            key={category}
            label={CATEGORY_LABELS[category]}
            value={summary.categories[category].per18}
          />
        ))}
      </div>
    </div>
  )
}

function StrokesGainedMetric({
  detail,
  label,
  value,
}: {
  detail: string
  label: string
  value: number | null
}) {
  return (
    <div className="strokes-gained-summary-metric">
      <span>{label}</span>
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
      <small>{detail}</small>
    </div>
  )
}
