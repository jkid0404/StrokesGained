import { CloudRequestError } from './cloudClient'
import type { CourseTemplate } from './domain'

export type CourseProposalStatus =
  | 'pending'
  | 'changes-requested'
  | 'approving'
  | 'approved'
  | 'rejected'
  | 'withdrawn'

export interface CourseProposal {
  id: string
  proposerId: string
  proposerDetails: string
  type: 'create' | 'edit'
  status: CourseProposalStatus
  targetCourseId: string | null
  targetTeeId: string | null
  baseCourseRevision: number
  targetCourseKey?: string | null
  baseCatalogRevision?: number
  baseCourse: CourseTemplate | null
  proposedCourse: CourseTemplate
  message: string
  submittedAt: string
  reviewedAt: string | null
  reviewerId: string | null
  reviewNote: string | null
}

export async function fetchCourseProposals(
  includeAll: boolean,
  signal?: AbortSignal,
): Promise<CourseProposal[]> {
  const response = await fetch(
    `/api/course-proposals${includeAll ? '?scope=all' : ''}`,
    {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal,
    },
  )
  const body = await parseBody(response)
  if (!response.ok || !Array.isArray(body?.proposals)) {
    throw new CloudRequestError(
      body?.error ?? `Proposal request failed with status ${response.status}.`,
      response.status,
    )
  }
  return body.proposals as CourseProposal[]
}

export async function submitCourseProposal({
  targetCourseId,
  targetTeeId,
  baseCourseRevision,
  baseCourse,
  proposedCourse,
  message,
}: {
  targetCourseId: string | null
  targetTeeId: string | null
  baseCourseRevision: number
  baseCourse: CourseTemplate | null
  proposedCourse: CourseTemplate
  message: string
}): Promise<CourseProposal> {
  const response = await fetch('/api/course-proposals', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      targetCourseId,
      targetTeeId,
      baseCourseRevision,
      baseCourse,
      proposedCourse,
      message,
    }),
  })
  return parseProposal(response)
}

export async function reviewCourseProposal(
  id: string,
  action: 'approve' | 'reject' | 'request-changes' | 'withdraw',
  note = '',
): Promise<CourseProposal> {
  const response = await fetch(`/api/course-proposals/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, note }),
  })
  return parseProposal(response)
}

async function parseProposal(response: Response): Promise<CourseProposal> {
  const body = await parseBody(response)
  if (!response.ok || !body?.proposal) {
    throw new CloudRequestError(
      body?.error ?? `Proposal request failed with status ${response.status}.`,
      response.status,
    )
  }
  return body.proposal as CourseProposal
}

async function parseBody(response: Response): Promise<{
  proposal?: unknown
  proposals?: unknown
  error?: string
} | null> {
  return (await response.json().catch(() => null)) as {
    proposal?: unknown
    proposals?: unknown
    error?: string
  } | null
}
