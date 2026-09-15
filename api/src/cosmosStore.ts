import { CosmosClient, type Container } from '@azure/cosmos'
import type { StatePayload, StoredState } from './stateModel.js'

let container: Container | null = null

export interface ReadResult {
  state: StoredState | null
  exists: boolean
}

export type WriteResult =
  | { conflict: false; state: StoredState }
  | { conflict: true; current: ReadResult }

export async function readOwnerState(ownerId: string): Promise<ReadResult> {
  try {
    const response = await getContainer().item(ownerId, ownerId).read<StoredState>()
    return {
      state: response.resource ?? null,
      exists: Boolean(response.resource),
    }
  } catch (error) {
    if (getStatusCode(error) === 404) return { state: null, exists: false }
    throw error
  }
}

export async function writeOwnerState(
  ownerId: string,
  payload: StatePayload,
): Promise<WriteResult> {
  const current = await readOwnerState(ownerId)
  const currentRevision = current.state?.revision ?? 0
  if (payload.revision !== currentRevision) {
    return { conflict: true, current }
  }

  const next: StoredState = {
    id: ownerId,
    ownerId,
    rounds: payload.rounds,
    courses: payload.courses,
    deletedCourseKeys: payload.deletedCourseKeys,
    revision: currentRevision + 1,
    updatedAt: new Date().toISOString(),
  }

  try {
    if (!current.exists) {
      const response = await getContainer().items.create<StoredState>(next)
      return { conflict: false, state: response.resource ?? next }
    }

    const response = await getContainer().item(ownerId, ownerId).replace<StoredState>(
      next,
      {
        accessCondition: current.state?._etag
          ? { type: 'IfMatch', condition: current.state._etag }
          : undefined,
      },
    )
    return { conflict: false, state: response.resource ?? next }
  } catch (error) {
    if (getStatusCode(error) === 409 || getStatusCode(error) === 412) {
      return { conflict: true, current: await readOwnerState(ownerId) }
    }
    throw error
  }
}

function getContainer(): Container {
  if (container) return container

  const connectionString = process.env.COSMOS_CONNECTION_STRING
  const databaseName = process.env.COSMOS_DATABASE_NAME
  const containerName = process.env.COSMOS_CONTAINER_NAME
  if (!connectionString || !databaseName || !containerName) {
    throw new Error('Cosmos DB settings are incomplete.')
  }

  container = new CosmosClient(connectionString)
    .database(databaseName)
    .container(containerName)
  return container
}

function getStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  if ('code' in error && typeof error.code === 'number') return error.code
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode
  }
  return undefined
}
