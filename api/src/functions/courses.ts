import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import { authorizePrincipal } from '../auth.js'
import {
  toCourseCatalogResponse,
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
      return json(200, toCourseCatalogResponse(await readCourseCatalog()))
    }
    if (!authorization.isAdmin) {
      return json(403, { error: 'Administrator access is required.' })
    }

    const payload = validateCourseCatalogPayload(await request.json())
    const result = await writeCourseCatalog(payload)
    if (result.conflict) {
      return json(409, toCourseCatalogResponse(result.catalog))
    }
    return json(200, toCourseCatalogResponse(result.catalog))
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return json(413, { error: error.message })
    }
    if (error instanceof ValidationError || error instanceof SyntaxError) {
      return json(400, {
        error: error instanceof Error ? error.message : 'Invalid request body.',
      })
    }

    context.error('Shared course catalog request failed.', error)
    return json(500, {
      error: 'The shared course catalog is temporarily unavailable.',
    })
  }
}

app.http('courses', {
  route: 'courses',
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  handler: coursesHandler,
})

function json(status: number, jsonBody: unknown): HttpResponseInit {
  return {
    status,
    jsonBody,
    headers: { 'Cache-Control': 'no-store' },
  }
}
