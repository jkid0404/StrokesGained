import { CosmosClient, type Container } from '@azure/cosmos'
import type {
  CourseProposal,
  CourseProposalStatus,
} from './courseProposalModel.js'

let container: Container | null = null

export async function createProposal(
  proposal: CourseProposal,
): Promise<CourseProposal> {
  const response = await getContainer().items.create<CourseProposal>(proposal)
  return response.resource ?? proposal
}

export async function listOwnerProposals(
  proposerId: string,
): Promise<CourseProposal[]> {
  const response = await getContainer().items
    .query<CourseProposal>({
      query:
        'SELECT * FROM c WHERE c.proposerId = @proposerId ORDER BY c.submittedAt DESC',
      parameters: [{ name: '@proposerId', value: proposerId }],
    })
    .fetchAll()
  return response.resources
}

export async function listAllProposals(): Promise<CourseProposal[]> {
  const response = await getContainer().items
    .query<CourseProposal>(
      'SELECT * FROM c ORDER BY c.submittedAt DESC',
    )
    .fetchAll()
  return response.resources
}

export async function readProposal(
  id: string,
): Promise<CourseProposal | null> {
  const response = await getContainer().items
    .query<CourseProposal>({
      query: 'SELECT TOP 1 * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: id }],
    })
    .fetchAll()
  return response.resources[0] ?? null
}

export async function updateProposalStatus(
  proposal: CourseProposal,
  status: CourseProposalStatus,
  reviewerId: string | null,
  reviewNote: string | null,
): Promise<CourseProposal> {
  const { _etag, ...persisted } = proposal
  const updated: CourseProposal = {
    ...persisted,
    status,
    reviewedAt: new Date().toISOString(),
    reviewerId,
    reviewNote,
  }
  const response = await getContainer()
    .item(proposal.id, proposal.proposerId)
    .replace<CourseProposal>(updated, {
      accessCondition: _etag
        ? { type: 'IfMatch', condition: _etag }
        : undefined,
    })
  return response.resource ?? updated
}

function getContainer(): Container {
  if (container) return container

  const connectionString = process.env.COSMOS_CONNECTION_STRING
  const databaseName = process.env.COSMOS_DATABASE_NAME
  const containerName = process.env.COSMOS_PROPOSALS_CONTAINER_NAME
  if (!connectionString || !databaseName || !containerName) {
    throw new Error('Course proposal settings are incomplete.')
  }

  container = new CosmosClient(connectionString)
    .database(databaseName)
    .container(containerName)
  return container
}
