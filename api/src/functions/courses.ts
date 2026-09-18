import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import { authorizePrincipal } from '../auth.js'
import {
  CourseConflictError,
  CourseNotFoundError,
  toPublishedCourseCatalogResponse,
  validateAddPublishedTeePayload,
  validateCreatePublishedCoursePayload,
  validateDeletePublishedTeePayload,
  validateUpdatePublishedTeePayload,
} from '../courseCatalogV2Model.js'
import {
  addPublishedTee,
  createPublishedCourse,
  deletePublishedTee,
  listPublishedCourses,
  updatePublishedTee,
} from '../courseCatalogV2Store.js'
import {
  PayloadTooLargeError,
  ValidationError,
} from '../stateModel.js'

async function coursesHandler(
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
    if (request.method === 'GET') {
      return json(
        200,
        toPublishedCourseCatalogResponse(await listPublishedCourses()),
      )
    }
    if (!authorization.isAdmin) {
      return json(403, { error: 'Administrator access is required.' })
    }
    if (request.method === 'POST') {
      await createPublishedCourse(
        validateCreatePublishedCoursePayload(await request.json()),
      )
      return json(
        201,
        toPublishedCourseCatalogResponse(await listPublishedCourses()),
      )
    }
    return json(405, { error: 'Method not allowed.' })
  } catch (error) {
    return handleError(error, context)
  }
}

async function courseTeeHandler(
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

  if (!authorization.isAdmin) {
    return json(403, { error: 'Administrator access is required.' })
  }

  try {
    const courseId = request.params.courseId
    const teeId = request.params.teeId
    if (!courseId || !teeId) {
      return json(404, { error: 'Shared course tee not found.' })
    }
    if (request.method === 'PATCH') {
      await updatePublishedTee(
        courseId,
        teeId,
        validateUpdatePublishedTeePayload(await request.json()),
      )
    } else if (request.method === 'DELETE') {
      const payload = validateDeletePublishedTeePayload(await request.json())
      await deletePublishedTee(courseId, teeId, payload.revision)
    } else {
      return json(405, { error: 'Method not allowed.' })
    }
    return json(
      200,
      toPublishedCourseCatalogResponse(await listPublishedCourses()),
    )
  } catch (error) {
    return handleError(error, context)
  }
}

async function courseTeesHandler(
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
  if (!authorization.isAdmin) {
    return json(403, { error: 'Administrator access is required.' })
  }

  try {
    const courseId = request.params.courseId
    if (!courseId) return json(404, { error: 'Shared course not found.' })
    if (request.method !== 'POST') {
      return json(405, { error: 'Method not allowed.' })
    }
    await addPublishedTee(
      courseId,
      validateAddPublishedTeePayload(await request.json()),
    )
    return json(
      201,
      toPublishedCourseCatalogResponse(await listPublishedCourses()),
    )
  } catch (error) {
    return handleError(error, context)
  }
}

app.http('courses', {
  route: 'courses',
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: coursesHandler,
})

app.http('courseTee', {
  route: 'courses/{courseId}/tees/{teeId}',
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  handler: courseTeeHandler,
})

app.http('courseTees', {
  route: 'courses/{courseId}/tees',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: courseTeesHandler,
})

async function handleError(
  error: unknown,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  if (error instanceof PayloadTooLargeError) {
    return json(413, { error: error.message })
  }
  if (error instanceof ValidationError || error instanceof SyntaxError) {
    return json(400, {
      error: error instanceof Error ? error.message : 'Invalid request body.',
    })
  }
  if (error instanceof CourseNotFoundError) {
    return json(404, { error: error.message })
  }
  if (error instanceof CourseConflictError) {
    return json(409, {
      error: error.message,
      ...toPublishedCourseCatalogResponse(await listPublishedCourses()),
    })
  }

  context.error('Shared course catalog request failed.', error)
  return json(500, {
    error: 'The shared course catalog is temporarily unavailable.',
  })
}

function json(status: number, jsonBody: unknown): HttpResponseInit {
  return {
    status,
    jsonBody,
    headers: { 'Cache-Control': 'no-store' },
  }
}
