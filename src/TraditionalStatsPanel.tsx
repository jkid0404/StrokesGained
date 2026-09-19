import type { TraditionalStats } from './traditionalStats'

export function TraditionalStatsPanel({
  stats,
  context,
  averagesOnly = false,
  showContextPill = true,
}: {
  stats: TraditionalStats
  context: string
  averagesOnly?: boolean
  showContextPill?: boolean
}) {
  const puttsPer18 =
    stats.puttsPerHole === null ? null : stats.puttsPerHole * 18
  const penaltiesPer18 =
    stats.holesPlayed > 0
      ? (stats.penaltyStrokes / stats.holesPlayed) * 18
      : null
  const onePuttPercentage =
    stats.holesPlayed > 0 ? (stats.onePutts / stats.holesPlayed) * 100 : null
  const threePuttPercentage =
    stats.holesPlayed > 0 ? (stats.threePutts / stats.holesPlayed) * 100 : null

  return (
    <div className="card traditional-stats-card">
      <div className="section-heading compact-heading">
        <div>
          <span className="eyebrow">Traditional statistics</span>
          <h2>{context}</h2>
        </div>
        {showContextPill && (
          <span className="pill">
            {stats.holesPlayed} hole{stats.holesPlayed === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="traditional-stat-grid">
        <TraditionalMetric
          detail={averagesOnly ? 'Fairway hit rate' : formatPercentage(stats.fairways)}
          label="Fairways hit"
          value={
            averagesOnly
              ? formatPercentage(stats.fairways, 'N/A')
              : formatCount(stats.fairways)
          }
        />
        <TraditionalMetric
          detail={
            averagesOnly
              ? 'Green-in-regulation rate'
              : formatPercentage(stats.greensInRegulation)
          }
          label="Greens in regulation"
          value={
            averagesOnly
              ? formatPercentage(stats.greensInRegulation, 'N/A')
              : formatCount(stats.greensInRegulation)
          }
        />
        <TraditionalMetric
          detail={
            averagesOnly
              ? stats.puttsPerHole === null
                ? 'No completed holes'
                : `${stats.puttsPerHole.toFixed(2)} per hole`
              : stats.puttsPerHole === null
                ? 'No completed holes'
                : `${puttsPer18!.toFixed(1)} per 18 · ${stats.puttsPerHole.toFixed(2)} per hole`
          }
          label="Putts"
          value={
            averagesOnly
              ? puttsPer18 === null
                ? 'N/A'
                : puttsPer18.toFixed(1)
              : String(stats.putts)
          }
        />
        <TraditionalMetric
          detail={
            averagesOnly
              ? 'Average on GIR holes'
              : stats.greensInRegulation.made
              ? `${stats.puttsOnGreensInRegulation} putts on GIR holes`
              : 'No greens in regulation'
          }
          label="Putts per GIR"
          value={formatDecimal(stats.puttsPerGreenInRegulation)}
        />
        <TraditionalMetric
          detail={averagesOnly ? 'Scrambling rate' : formatPercentage(stats.scrambling)}
          label="Scrambling"
          value={
            averagesOnly
              ? formatPercentage(stats.scrambling, 'N/A')
              : formatCount(stats.scrambling)
          }
        />
        <TraditionalMetric
          detail={averagesOnly ? 'Up-and-down rate' : formatPercentage(stats.upAndDowns)}
          label="Up and downs"
          value={
            averagesOnly
              ? formatPercentage(stats.upAndDowns, 'N/A')
              : formatCount(stats.upAndDowns)
          }
        />
        <TraditionalMetric
          detail={
            averagesOnly
              ? 'Greenside rate from 30 yd or less'
              : `${formatPercentage(stats.sandSaves)} · greenside estimated at 30 yd or less`
          }
          label="Sand saves"
          value={
            averagesOnly
              ? formatPercentage(stats.sandSaves, 'N/A')
              : formatCount(stats.sandSaves)
          }
        />
        <TraditionalMetric
          detail={
            averagesOnly
              ? 'Average finishing distance'
              : `${stats.approachProximityShots} shot${
                  stats.approachProximityShots === 1 ? '' : 's'
                } measured`
          }
          label="Approach proximity"
          value={
            stats.approachProximityFeet === null
              ? 'N/A'
              : `${stats.approachProximityFeet.toFixed(1)} ft`
          }
        />
        <TraditionalMetric
          detail={
            averagesOnly
              ? 'One-putt / three-putt rates'
              : 'One-putt / three-putt holes'
          }
          label="Putting outcomes"
          value={
            averagesOnly
              ? `${formatOptionalPercentage(onePuttPercentage)} / ${formatOptionalPercentage(
                  threePuttPercentage,
                )}`
              : `${stats.onePutts} / ${stats.threePutts}`
          }
        />
        <TraditionalMetric
          detail={averagesOnly ? 'Average per 18 holes' : 'Included in total score'}
          label="Penalty strokes"
          value={
            averagesOnly
              ? penaltiesPer18 === null
                ? 'N/A'
                : penaltiesPer18.toFixed(1)
              : String(stats.penaltyStrokes)
          }
        />
      </div>

      <div className="traditional-breakdown-grid">
        <TraditionalBreakdown
          label={averagesOnly ? 'Scoring per round' : 'Scoring'}
          values={[
            [
              'Eagles or better',
              averagesOnly
                ? formatPerRound(stats.scoring.eaglesOrBetter, stats.rounds)
                : stats.scoring.eaglesOrBetter,
            ],
            [
              'Birdies',
              averagesOnly
                ? formatPerRound(stats.scoring.birdies, stats.rounds)
                : stats.scoring.birdies,
            ],
            [
              'Pars',
              averagesOnly
                ? formatPerRound(stats.scoring.pars, stats.rounds)
                : stats.scoring.pars,
            ],
            [
              'Bogeys',
              averagesOnly
                ? formatPerRound(stats.scoring.bogeys, stats.rounds)
                : stats.scoring.bogeys,
            ],
            [
              'Double bogeys+',
              averagesOnly
                ? formatPerRound(stats.scoring.doubleBogeysOrWorse, stats.rounds)
                : stats.scoring.doubleBogeysOrWorse,
            ],
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

function formatPercentage(
  metric: { made: number; opportunities: number },
  emptyValue = 'No opportunities',
): string {
  return metric.opportunities
    ? `${Math.round((metric.made / metric.opportunities) * 100)}%`
    : emptyValue
}

function formatOptionalPercentage(value: number | null): string {
  return value === null ? 'N/A' : `${Math.round(value)}%`
}

function formatPerRound(value: number, rounds: number): string {
  return rounds > 0 ? (value / rounds).toFixed(1) : 'N/A'
}

function formatDecimal(value: number | null): string {
  return value === null ? 'N/A' : value.toFixed(2)
}

function formatSigned(value: number): string {
  if (Math.abs(value) < 0.05) return 'E'
  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1)
}
