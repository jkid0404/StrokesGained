import {
  app,
  type HttpRequest,
  type HttpResponseInit,
} from '@azure/functions'
import { authorizePrincipal } from '../auth.js'

async function accessHandler(
  request: HttpRequest,
): Promise<HttpResponseInit> {
  const authorization = authorizePrincipal(
    request.headers.get('x-ms-client-principal'),
    process.env.ADMIN_USER_EMAIL,
  )
  if (!authorization.authorized) {
    return {
      status: authorization.status,
      jsonBody: { error: authorization.message },
      headers: { 'Cache-Control': 'no-store' },
    }
  }

  return {
    status: 200,
    jsonBody: {
      isAdmin: authorization.isAdmin,
      roles: authorization.isAdmin
        ? ['golfer', 'admin']
        : ['golfer'],
    },
    headers: { 'Cache-Control': 'no-store' },
  }
}

app.http('access', {
  route: 'access',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: accessHandler,
})
