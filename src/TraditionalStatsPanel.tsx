import type { TraditionalStats } from './traditionalStats'

export function TraditionalStatsPanel({
  stats,
  context,
}: {
  stats: TraditionalStats
  context: string
}) {
  return (
    <div className="card traditional-stats-card">
      <div className="section-heading compact-heading">
        <div>
          <span className="eyebrow">Traditional statistics</span>
          <h2>{context}</h2>
        </div>
        <span className="pill">
          {stats.holesPlayed} hole{stats.holesPlayed === 1 ? '' : 's'}
        </span>
      </div>

      <div className="traditional-stat-grid">
        <TraditionalMetric
          detail={formatPercentage(stats.fairways)}
          label="Fairways hit"
          value={formatCount(stats.fairways)}
        />
        <TraditionalMetric
          detail={formatPercentage(stats.greensInRegulation)}
          label="Greens in regulation"
          value={formatCount(stats.greensInRegulation)}
        />
        <TraditionalMetric
          detail={
            stats.puttsPerHole === null
              ? 'No completed holes'
              : `${(stats.puttsPerHole * 18).toFixed(1)} per 18 · ${stats.puttsPerHole.toFixed(2)} per hole`
          }
          label="Putts"
          value={String(stats.putts)}
        />
        <TraditionalMetric
          detail={
            stats.greensInRegulation.made
              ? `${stats.puttsOnGreensInRegulation} putts on GIR holes`
              : 'No greens in regulation'
          }
          label="Putts per GIR"
          value={formatDecimal(stats.puttsPerGreenInRegulation)}
        />
        <TraditionalMetric
          detail={formatPercentage(stats.scrambling)}
          label="Scrambling"
          value={formatCount(stats.scrambling)}
        />
        <TraditionalMetric
          detail={formatPercentage(stats.upAndDowns)}
          label="Up and downs"
          value={formatCount(stats.upAndDowns)}
        />
        <TraditionalMetric
          detail={`${formatPercentage(stats.sandSaves)} · greenside estimated at 30 yd or less`}
          label="Sand saves"
          value={formatCount(stats.sandSaves)}
        />
        <TraditionalMetric
          detail={`${stats.approachProximityShots} shot${
            stats.approachProximityShots === 1 ? '' : 's'
          } measured`}
          label="Approach proximity"
          value={
            stats.approachProximityFeet === null
              ? 'N/A'
              : `${stats.approachProximityFeet.toFixed(1)} ft`
          }
        />
        <TraditionalMetric
          detail="One-putt / three-putt holes"
          label="Putting outcomes"
          value={`${stats.onePutts} / ${stats.threePutts}`}
        />
        <TraditionalMetric
          detail="Included in total score"
          label="Penalty strokes"
          value={String(stats.penaltyStrokes)}
        />
      </div>

      <div className="traditional-breakdown-grid">
        <TraditionalBreakdown
          label="Scoring"
          values={[
            ['Eagles or better', stats.scoring.eaglesOrBetter],
            ['Birdies', stats.scoring.birdies],
            ['Pars', stats.scoring.pars],
            ['Bogeys', stats.scoring.bogeys],
            ['Double bogeys+', stats.scoring.doubleBogeysOrWorse],
          ]}
        />
        <TraditionalBreakdown
          label="Scoring by par"
          values={[
            [
              'Score / 18',
              stats.holesPlayed
                ? ((stats.totalStrokes / stats.holesPlayed) * 18).toFixed(1)
                : 'N/A',
            ],
            [
              'To par / 18',
              stats.holesPlayed
                ? formatSigned((stats.scoreToPar / stats.holesPlayed) * 18)
                : 'N/A',
            ],
            ...([3, 4, 5] as const).map(
              (par): [string, string] => [
                `Par ${par}`,
                stats.parScoring[par].average === null
                  ? 'N/A'
                  : stats.parScoring[par].average!.toFixed(2),
              ],
            ),
          ]}
        />
      </div>
      <p className="traditional-definition-note">
        Fairways include penalty-free par 4/5 tee shots finishing on the fairway
        or green. Short-game opportunities use shots from 30 yards or less.
      </p>
    </div>
  )
}

function TraditionalMetric({
  detail,
  label,
  value,
}: {
  detail: string
  label: string
  value: string
}) {
  return (
    <div className="traditional-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

function TraditionalBreakdown({
  label,
  values,
}: {
  label: string
  values: Array<[string, number | string]>
}) {
  return (
    <div className="traditional-breakdown">
      <strong>{label}</strong>
      {values.map(([name, value]) => (
        <span key={name}>
          <small>{name}</small>
          <b>{value}</b>
        </span>
      ))}
    </div>
  )
}

function formatCount(metric: { made: number; opportunities: number }): string {
  return metric.opportunities ? `${metric.made}/${metric.opportunities}` : 'N/A'
}

function formatPercentage(metric: { made: number; opportunities: number }): string {
  return metric.opportunities
    ? `${Math.round((metric.made / metric.opportunities) * 100)}%`
    : 'No opportunities'
}

function formatDecimal(value: number | null): string {
  return value === null ? 'N/A' : value.toFixed(2)
}

function formatSigned(value: number): string {
  if (Math.abs(value) < 0.05) return 'E'
  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1)
}
