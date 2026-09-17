import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import { authorizePrincipal } from '../auth.js'
import {
  applyApprovedProposal,
  createCourseProposal,
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
  validateCourseCatalogPayload,
} from '../courseCatalogModel.js'
import {
  readCourseCatalog,
  writeCourseCatalog,
} from '../courseCatalogStore.js'
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
      const catalog = await readCourseCatalog()
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
    applyApprovedProposal(proposal, await readCourseCatalog())
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
    const catalog = await readCourseCatalog()
    const courses = applyApprovedProposal(claimedProposal, catalog)
    if (JSON.stringify(courses) !== JSON.stringify(catalog?.courses ?? [])) {
      const payload = validateCourseCatalogPayload({
        courses,
        revision: catalog?.revision ?? 0,
      })
      const result = await writeCourseCatalog(payload)
      if (result.conflict) {
        await returnProposalForChanges(
          claimedProposal,
          reviewerId,
          'The shared course catalog changed during approval. Review and retry.',
        )
        return json(409, {
          error: 'The shared course catalog changed elsewhere.',
        })
      }
    }
  } catch (error) {
    if (
      error instanceof ProposalConflictError ||
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
