import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import { authorizePrincipal } from '../auth.js'
import { readOwnerState, writeOwnerState } from '../cosmosStore.js'
import {
  PayloadTooLargeError,
  toStateResponse,
  validateStatePayload,
  ValidationError,
} from '../stateModel.js'

async function stateHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const authorization = authorizePrincipal(
    request.headers.get('x-ms-client-principal'),
    process.env.ALLOWED_USER_EMAIL,
  )
  if (!authorization.authorized) {
    return json(authorization.status, { error: authorization.message })
  }

  try {
    if (request.method === 'GET') {
      const current = await readOwnerState(authorization.principal.userId)
      return json(200, toStateResponse(current.state, current.exists))
    }

    const payload = validateStatePayload(await request.json())
    const result = await writeOwnerState(authorization.principal.userId, payload)
    if (result.conflict) {
      return json(409, toStateResponse(result.current.state, result.current.exists))
    }

    return json(200, toStateResponse(result.state, true))
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return json(413, { error: error.message })
    }
    if (error instanceof ValidationError || error instanceof SyntaxError) {
      return json(400, {
        error: error instanceof Error ? error.message : 'Invalid request body.',
      })
    }

    context.error('State API request failed.', error)
    return json(500, { error: 'The state service is temporarily unavailable.' })
  }
}

app.http('state', {
  route: 'state',
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  handler: stateHandler,
})

function json(status: number, jsonBody: unknown): HttpResponseInit {
  return {
    status,
    jsonBody,
    headers: { 'Cache-Control': 'no-store' },
  }
}
