import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  listClusters,
  getClusterById,
  listVms,
  getVmById,
  listDisksByVmId,
  listCvmsByClusterId,
  getCvmById,
} from './nutanix-client.js';

const LIST_QUERY_SCHEMA_PROPS = {
  page: {
    type: 'number',
    description: 'Zero-based page index (default 0)',
  },
  limit: {
    type: 'number',
    description: 'Maximum number of results to return (default 50)',
  },
  select: {
    type: 'string',
    description: 'Optional fields selector forwarded as $select',
  },
} as const;

const TOOLS = [
  {
    name: 'list_clusters',
    description: 'List Nutanix clusters visible from Prism Central.',
    inputSchema: {
      type: 'object',
      properties: LIST_QUERY_SCHEMA_PROPS,
      additionalProperties: false,
    },
  },
  {
    name: 'get_cluster_by_id',
    description: 'Retrieve details of a specific Nutanix cluster by its external UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        extId: {
          type: 'string',
          description: 'External UUID of the cluster',
        },
      },
      required: ['extId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_vms',
    description: 'List virtual machines managed by Prism Central.',
    inputSchema: {
      type: 'object',
      properties: LIST_QUERY_SCHEMA_PROPS,
      additionalProperties: false,
    },
  },
  {
    name: 'get_vm_by_id',
    description: 'Retrieve the configuration of a specific virtual machine by its external UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        extId: {
          type: 'string',
          description: 'External UUID of the VM',
        },
      },
      required: ['extId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_disks_by_vm_id',
    description: 'List the disks attached to a specific virtual machine.',
    inputSchema: {
      type: 'object',
      properties: {
        vmExtId: {
          type: 'string',
          description: 'External UUID of the VM',
        },
        ...LIST_QUERY_SCHEMA_PROPS,
      },
      required: ['vmExtId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_cvms_by_cluster_id',
    description: 'List the CVMs managed by Prism Central.',
    inputSchema: {
      type: 'object',
      properties: {
        clusterExtId: {
          type: 'string',
          description: 'External UUID of the cluster',
        },
        ...LIST_QUERY_SCHEMA_PROPS,
      },
      required: ['clusterExtId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_cvm_by_id',
    description: 'Retrieve the configuration of a specific CVM by its external UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        clusterExtId: {
          type: 'string',
          description: 'External UUID of the cluster',
        },
        cvmExtId: {
          type: 'string',
          description: 'External UUID of the CVM',
        },
      },
      required: ['clusterExtId', 'cvmExtId'],
      additionalProperties: false,
    },
  },
] as const;

const server = new Server(
  { name: 'nutanix-demo', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const a = args as Record<string, unknown>;
  const listOpts = {
    page: typeof a.page === 'number' ? a.page : 0,
    limit: typeof a.limit === 'number' ? a.limit : 50,
    select: typeof a.select === 'string' ? a.select : undefined,
  };

  try {
    let result: unknown;

    switch (name) {
      case 'list_clusters':
        result = await listClusters(listOpts);
        break;

      case 'get_cluster_by_id':
        if (typeof a.extId !== 'string' || !a.extId) {
          throw new Error('extId is required and must be a string');
        }
        result = await getClusterById(a.extId);
        break;

      case 'list_vms':
        result = await listVms(listOpts);
        break;

      case 'get_vm_by_id':
        if (typeof a.extId !== 'string' || !a.extId) {
          throw new Error('extId is required and must be a string');
        }
        result = await getVmById(a.extId);
        break;

      case 'list_disks_by_vm_id':
        if (typeof a.vmExtId !== 'string' || !a.vmExtId) {
          throw new Error('vmExtId is required and must be a string');
        }
        result = await listDisksByVmId(
          a.vmExtId,
          listOpts,
        );
        break;

      case 'list_cvms_by_cluster_id':
        if (typeof a.clusterExtId !== 'string' || !a.clusterExtId) {
          throw new Error('clusterExtId is required and must be a string');
        }
        result = await listCvmsByClusterId(a.clusterExtId, listOpts);
        break;

      case 'get_cvm_by_id':
        if (typeof a.clusterExtId !== 'string' || !a.clusterExtId) {
          throw new Error('clusterExtId is required and must be a string');
        }
        if (typeof a.cvmExtId !== 'string' || !a.cvmExtId) {
          throw new Error('cvmExtId is required and must be a string');
        }
        result = await getCvmById(a.clusterExtId, a.cvmExtId);
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    const serialized = result !== undefined ? JSON.stringify(result, null, 2) : undefined;
    const text = typeof serialized === 'string' ? serialized : 'null';
    return {
      content: [{ type: 'text', text }],
    };
  } catch (err) {
    const message = formatUnknownError(err);
    return {
      isError: true,
      content: [{ type: 'text', text: message }],
    };
  }
});

function formatUnknownError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }

  if (typeof err === 'string') {
    return err;
  }

  if (typeof err === 'object' && err !== null) {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === 'string' && rec.message.trim().length > 0) {
      return rec.message;
    }
    try {
      return JSON.stringify(rec, null, 2);
    } catch {
      return '[unserializable object error]';
    }
  }

  return String(err);
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[nutanix-demo] MCP server running on stdio');
}

main().catch((err) => {
  console.error('[nutanix-demo] Fatal:', err);
  process.exit(1);
});
