import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import { authorizePrincipal } from '../auth.js'
import {
  assertProposalCanUpdate,
  createCourseProposal,
  proposalAlreadyApplied,
  ProposalConflictError,
  validateCreateCourseProposal,
  validateReviewAction,
  type CourseProposal,
} from '../courseProposalModel.js'
import {
  createProposal,
  listAllProposals,
  listOwnerProposals,
  readProposal,
  updateProposalStatus,
} from '../courseProposalStore.js'
import {
  createPublishedCourse,
  findPublishedTemplate,
  findPublishedTemplateByIdentity,
  listPublishedCourses,
  updatePublishedTee,
} from '../courseCatalogV2Store.js'
import {
  CourseConflictError,
  CourseNotFoundError,
  flattenCourseAggregate,
} from '../courseCatalogV2Model.js'
import {
  PayloadTooLargeError,
  ValidationError,
} from '../stateModel.js'

async function courseProposalsHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const authorization = authorizePrincipal(
    request.headers.get('x-ms-client-principal'),
    process.env.ADMIN_USER_EMAIL,
  )
  if (!authorization.authorized) {
    return json(authorization.status, { error: authorization.message })
  }

  try {
    const id = request.params.id
    if (request.method === 'GET') {
      const proposals =
        request.query.get('scope') === 'all' && authorization.isAdmin
          ? await listAllProposals()
          : await listOwnerProposals(authorization.principal.userId)
      return json(200, { proposals })
    }

    if (request.method === 'POST' && !id) {
      const payload = validateCreateCourseProposal(await request.json())
      const catalog = (await listPublishedCourses()).flatMap(
        flattenCourseAggregate,
      )
      const proposal = createCourseProposal(
        payload,
        authorization.principal,
        catalog,
      )
      return json(201, { proposal: await createProposal(proposal) })
    }

    if (request.method === 'PATCH' && id) {
      const proposal = await readProposal(id)
      if (!proposal) return json(404, { error: 'Proposal not found.' })
      const { action, note } = validateReviewAction(await request.json())

      if (action === 'withdraw') {
        if (
          proposal.proposerId !== authorization.principal.userId &&
          !authorization.isAdmin
        ) {
          return json(403, { error: 'You cannot withdraw this proposal.' })
        }
        if (
          proposal.status !== 'pending' &&
          proposal.status !== 'changes-requested'
        ) {
          return json(409, { error: 'This proposal can no longer be withdrawn.' })
        }
        return json(200, {
          proposal: await updateProposalStatus(
            proposal,
            'withdrawn',
            authorization.principal.userId,
            note || null,
          ),
        })
      }

      if (!authorization.isAdmin) {
        return json(403, { error: 'Administrator access is required.' })
      }
      if (
        proposal.status !== 'pending' &&
        proposal.status !== 'changes-requested' &&
        !(action === 'approve' && proposal.status === 'approving')
      ) {
        return json(409, { error: 'This proposal has already been reviewed.' })
      }

      if (action === 'approve') {
        return approveProposal(proposal, authorization.principal.userId, note)
      }
      return json(200, {
        proposal: await updateProposalStatus(
          proposal,
          action === 'reject' ? 'rejected' : 'changes-requested',
          authorization.principal.userId,
          note || null,
        ),
      })
    }

    return json(405, { error: 'Method not allowed.' })
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return json(413, { error: error.message })
    }
    if (error instanceof ValidationError) {
      return json(400, { error: error.message })
    }
    if (error instanceof SyntaxError) {
      return json(400, { error: 'Invalid request body.' })
    }
    if (error instanceof ProposalConflictError) {
      return json(409, { error: error.message })
    }
    if (
      error instanceof CourseConflictError ||
      error instanceof CourseNotFoundError
    ) {
      return json(409, { error: error.message })
    }
    if (getStatusCode(error) === 409 || getStatusCode(error) === 412) {
      return json(409, { error: 'The proposal changed elsewhere.' })
    }

    context.error('Course proposal request failed.', error)
    return json(500, { error: 'The course proposal service is unavailable.' })
  }
}

async function approveProposal(
  proposal: CourseProposal,
  reviewerId: string,
  note: string,
): Promise<HttpResponseInit> {
  if (proposal.status !== 'approving') {
    await validateProposalApproval(proposal)
  }
  const claimedProposal =
    proposal.status === 'approving'
      ? proposal
      : await updateProposalStatus(
          proposal,
          'approving',
          reviewerId,
          note || null,
        )
  try {
    await applyProposalMutation(claimedProposal)
  } catch (error) {
    if (
      error instanceof ProposalConflictError ||
      error instanceof CourseConflictError ||
      error instanceof CourseNotFoundError ||
      error instanceof ValidationError ||
      error instanceof PayloadTooLargeError
    ) {
      await returnProposalForChanges(
        claimedProposal,
        reviewerId,
        error.message,
      )
    }
    throw error
  }
  return json(200, {
    proposal: await updateProposalStatus(
      claimedProposal,
      'approved',
      reviewerId,
      note || null,
    ),
  })
}

async function validateProposalApproval(
  proposal: CourseProposal,
): Promise<void> {
  if (proposal.type === 'create') {
    assertCreateProposalHasIds(proposal)
    const existing = await findPublishedTemplate(
      proposal.proposedCourse.courseId,
      proposal.proposedCourse.teeId,
    )
    if (existing && !proposalAlreadyApplied(proposal, existing)) {
      throw new ProposalConflictError(
        'The proposed immutable course identity is already in use.',
      )
    }
    return
  }
  const current = await findProposalTarget(proposal)
  if (!proposalAlreadyApplied(proposal, current)) {
    assertProposalCanUpdate(proposal, current)
  }
}

async function applyProposalMutation(proposal: CourseProposal): Promise<void> {
  const current = await findProposalTarget(proposal)
  if (proposalAlreadyApplied(proposal, current)) return

  if (proposal.type === 'create') {
    assertCreateProposalHasIds(proposal)
    await createPublishedCourse(
      {
        name: proposal.proposedCourse.name,
        teeName: proposal.proposedCourse.teeName,
        holes: proposal.proposedCourse.holes,
      },
      {
        courseId: proposal.proposedCourse.courseId,
        teeId: proposal.proposedCourse.teeId,
      },
    )
    return
  }

  assertProposalCanUpdate(proposal, current)
  await updatePublishedTee(
    current.courseId,
    current.teeId,
    {
      name: proposal.proposedCourse.name,
      teeName: proposal.proposedCourse.teeName,
      holes: proposal.proposedCourse.holes,
      revision: current.revision,
    },
  )
}

async function findProposalTarget(
  proposal: CourseProposal,
) {
  if (proposal.targetCourseId && proposal.targetTeeId) {
    return findPublishedTemplate(
      proposal.targetCourseId,
      proposal.targetTeeId,
    )
  }
  if (proposal.targetCourseKey) {
    return findPublishedTemplateByIdentity(proposal.targetCourseKey)
  }
  return null
}

function assertCreateProposalHasIds(proposal: CourseProposal): void {
  if (
    !proposal.proposedCourse.courseId ||
    !proposal.proposedCourse.teeId
  ) {
    throw new ProposalConflictError(
      'This legacy new-course proposal must be resubmitted to receive immutable IDs.',
    )
  }
}

async function returnProposalForChanges(
  proposal: CourseProposal,
  reviewerId: string,
  note: string,
): Promise<void> {
  await updateProposalStatus(
    proposal,
    'changes-requested',
    reviewerId,
    note.slice(0, 500),
  )
}

app.http('courseProposals', {
  route: 'course-proposals/{id?}',
  methods: ['GET', 'POST', 'PATCH'],
  authLevel: 'anonymous',
  handler: courseProposalsHandler,
})

function json(status: number, jsonBody: unknown): HttpResponseInit {
  return {
    status,
    jsonBody,
    headers: { 'Cache-Control': 'no-store' },
  }
}

function getStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  if ('code' in error && typeof error.code === 'number') return error.code
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode
  }
  return undefined
}
