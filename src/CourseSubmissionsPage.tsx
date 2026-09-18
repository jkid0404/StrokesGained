import { useCallback, useEffect, useState } from 'react'
import {
  fetchCourseProposals,
  reviewCourseProposal,
  type CourseProposal,
  type CourseProposalStatus,
} from './courseProposals'

const STATUS_LABELS: Record<CourseProposalStatus, string> = {
  pending: 'Pending',
  'changes-requested': 'Changes requested',
  approving: 'Approving',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

export function CourseSubmissionsPage({
  isAdmin,
  onBack,
  onCatalogChanged,
}: {
  isAdmin: boolean
  onBack: () => void
  onCatalogChanged: () => void
}) {
  const [proposals, setProposals] = useState<CourseProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeAction, setActiveAction] = useState<string | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      try {
        setProposals(await fetchCourseProposals(isAdmin, signal))
        setError('')
      } catch (loadError) {
        if (
          loadError instanceof DOMException &&
          loadError.name === 'AbortError'
        ) {
          return
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load course submissions.',
        )
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [isAdmin],
  )

  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(controller.signal)
    })
    return () => controller.abort()
  }, [load])

  async function act(
    proposal: CourseProposal,
    action: 'approve' | 'reject' | 'request-changes' | 'withdraw',
  ) {
    const note =
      action === 'approve' || action === 'withdraw'
        ? ''
        : window.prompt(
            action === 'reject'
              ? 'Why is this proposal being rejected?'
              : 'What should the golfer change?',
          ) ?? ''
    if ((action === 'reject' || action === 'request-changes') && !note.trim()) {
      return
    }

    setActiveAction(`${proposal.id}:${action}`)
    try {
      await reviewCourseProposal(proposal.id, action, note)
      if (action === 'approve') onCatalogChanged()
      await load()
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Unable to update this proposal.',
      )
    } finally {
      setActiveAction(null)
    }
  }

  return (
    <section className="page course-submissions-page">
      <button className="text-button" type="button" onClick={onBack}>
        ← Back to courses
      </button>
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {isAdmin ? 'Shared catalog moderation' : 'Course contributions'}
          </span>
          <h1 className="page-title">
            {isAdmin ? 'Review submissions' : 'My submissions'}
          </h1>
        </div>
        <span className="pill">{proposals.length} submissions</span>
      </div>

      {error && <div className="error-message">{error}</div>}
      {loading ? (
        <div className="empty-state">
          <h3>Loading submissions…</h3>
        </div>
      ) : proposals.length === 0 ? (
        <div className="empty-state">
          <h3>No course submissions</h3>
          <p>
            {isAdmin
              ? 'New publication requests and shared-course edits will appear here.'
              : 'Submit a personal course or suggest an edit to a shared course.'}
          </p>
        </div>
      ) : (
        <div className="course-proposal-list">
          {proposals.map((proposal) => (
            <article className="card course-proposal-card" key={proposal.id}>
              <div className="section-heading compact-heading">
                <div>
                  <span className="eyebrow">
                    {proposal.type === 'create'
                      ? 'New shared course'
                      : 'Shared course edit'}
                  </span>
                  <h2>
                    {proposal.proposedCourse.name} ·{' '}
                    {proposal.proposedCourse.teeName}
                  </h2>
                </div>
                <span className={`pill proposal-${proposal.status}`}>
                  {STATUS_LABELS[proposal.status]}
                </span>
              </div>
              <div className="proposal-meta">
                {isAdmin && <span>Submitted by {proposal.proposerDetails}</span>}
                <span>{formatDateTime(proposal.submittedAt)}</span>
                <span>
                  Based on{' '}
                  {proposal.baseCourseRevision === undefined
                    ? `legacy catalog revision ${proposal.baseCatalogRevision ?? 0}`
                    : `course revision ${proposal.baseCourseRevision}`}
                </span>
              </div>
              {proposal.message && (
                <p className="proposal-message">{proposal.message}</p>
              )}
              <CourseProposalDiff proposal={proposal} />
              {proposal.reviewNote && (
                <div className="proposal-review-note">
                  <strong>Review note</strong>
                  <span>{proposal.reviewNote}</span>
                </div>
              )}
              <div className="proposal-actions">
                {isAdmin &&
                  (proposal.status === 'pending' ||
                    proposal.status === 'changes-requested' ||
                    proposal.status === 'approving') && (
                    <>
                      <button
                        className="primary compact"
                        disabled={activeAction !== null}
                        type="button"
                        onClick={() => void act(proposal, 'approve')}
                      >
                        {proposal.status === 'approving'
                          ? 'Retry approval'
                          : 'Approve'}
                      </button>
                      {proposal.status !== 'approving' && (
                        <>
                          <button
                            className="secondary compact"
                            disabled={activeAction !== null}
                            type="button"
                            onClick={() =>
                              void act(proposal, 'request-changes')
                            }
                          >
                            Request changes
                          </button>
                          <button
                            className="danger-button"
                            disabled={activeAction !== null}
                            type="button"
                            onClick={() => void act(proposal, 'reject')}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </>
                  )}
                {!isAdmin &&
                  (proposal.status === 'pending' ||
                    proposal.status === 'changes-requested') && (
                    <button
                      className="secondary compact"
                      disabled={activeAction !== null}
                      type="button"
                      onClick={() => void act(proposal, 'withdraw')}
                    >
                      Withdraw
                    </button>
                  )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function CourseProposalDiff({ proposal }: { proposal: CourseProposal }) {
  const base = proposal.baseCourse
  const holeNumbers = [
    ...new Set([
      ...Object.keys(base?.holes ?? {}),
      ...Object.keys(proposal.proposedCourse.holes),
    ]),
  ]
    .map(Number)
    .sort((a, b) => a - b)
  const changes = holeNumbers.filter(
    (number) =>
      JSON.stringify(base?.holes[number] ?? null) !==
      JSON.stringify(proposal.proposedCourse.holes[number] ?? null),
  )

  return (
    <div className="proposal-diff">
      {base &&
        (base.name !== proposal.proposedCourse.name ||
          base.teeName !== proposal.proposedCourse.teeName) && (
          <div className="proposal-identity-change">
            <span>
              {base.name} · {base.teeName}
            </span>
            <strong>→</strong>
            <span>
              {proposal.proposedCourse.name} ·{' '}
              {proposal.proposedCourse.teeName}
            </span>
          </div>
        )}
      <div className="proposal-hole-table">
        <div className="proposal-hole-row table-header">
          <span>Hole</span>
          <span>Current</span>
          <span>Proposed</span>
        </div>
        {(proposal.type === 'create' ? holeNumbers : changes).map((number) => (
          <div className="proposal-hole-row" key={number}>
            <strong>{number}</strong>
            <span>{formatHole(base?.holes[number])}</span>
            <span>{formatHole(proposal.proposedCourse.holes[number])}</span>
          </div>
        ))}
      </div>
      {proposal.type === 'edit' && changes.length === 0 && (
        <p className="muted">No hole yardage or par changes.</p>
      )}
    </div>
  )
}

function formatHole(
  hole: { par: number; yardage: number } | undefined,
): string {
  return hole ? `Par ${hole.par} · ${hole.yardage} yd` : 'Not configured'
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
