process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { ApiClient, ClustersApi } from '@nutanix-api/clustermgmt-js-client';
import { ApiClient as VmmApiClient, VmApi } from '@nutanix-api/vmm-js-client';
import { ApiClient as CvmsApiClient, CvmsApi } from '@nutanix-api/clustermgmt-js-client';

function buildClusterApiClient(): ClustersApi {
  const client = new ApiClient();
  client.host = process.env.NUTANIX_HOST ?? '10.47.104.90';
  client.port = process.env.NUTANIX_PORT ?? '9440';
  client.username = process.env.NUTANIX_USERNAME ?? 'admin';
  client.password = process.env.NUTANIX_PASSWORD ?? 'REPLACE_WITH_YOUR_PASSWORD';
  client.maxRetryAttempts = 3;
  client.retryInterval = 3000;
  return new ClustersApi(client);
}

function buildVmApiClient(): VmApi {
  const client = new VmmApiClient();
  client.host = process.env.NUTANIX_HOST ?? '10.47.104.90';
  client.port = process.env.NUTANIX_PORT ?? '9440';
  client.username = process.env.NUTANIX_USERNAME ?? 'admin';
  client.password = process.env.NUTANIX_PASSWORD ?? 'REPLACE_WITH_YOUR_PASSWORD';
  client.maxRetryAttempts = 3;
  client.retryInterval = 3000;
  return new VmApi(client);
}

function buildCvmsApiClient(): CvmsApi {
  const client = new CvmsApiClient();
  client.host = process.env.NUTANIX_HOST ?? '10.47.104.90';
  client.port = process.env.NUTANIX_PORT ?? '9440';
  client.username = process.env.NUTANIX_USERNAME ?? 'admin';
  client.password = process.env.NUTANIX_PASSWORD ?? 'REPLACE_WITH_YOUR_PASSWORD';
  client.maxRetryAttempts = 3;
  client.retryInterval = 3000;
  return new CvmsApi(client);
}
// Nutanix SDK responses vary: clustermgmt returns the payload directly on
// `data`, while vmm wraps it in an object with a getData() method. We try
// getData() first and fall back to `data` itself when it returns undefined.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrap(data: any): unknown {
  if (data == null) return data;
  if (typeof data.getData === 'function') {
    const inner = data.getData();
    return inner !== undefined ? inner : data;
  }
  return data;
}

export async function listClusters(page = 0, limit = 50): Promise<unknown> {
  const api = buildClusterApiClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: any = { '$page': page, '$limit': limit };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = (await api.listClusters(opts)) as { data: any };
  return unwrap(data);
}

export async function getClusterById(extId: string): Promise<unknown> {
  const api = buildClusterApiClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = (await api.getClusterById(extId, {} as any)) as { data: any };
  return unwrap(data);
}

export async function listVms(page = 0, limit = 50): Promise<unknown> {
  const api = buildVmApiClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: any = { '$page': page, '$limit': limit };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = (await api.listVms(opts)) as { data: any };
  return unwrap(data);
}

export async function getVmById(extId: string): Promise<unknown> {
  const api = buildVmApiClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = (await api.getVmById(extId)) as { data: any };
  return unwrap(data);
}

export async function listDisksByVmId(
  vmExtId: string,
  page = 0,
  limit = 50,
): Promise<unknown> {
  const api = buildVmApiClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: any = { '$page': page, '$limit': limit };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = (await api.listDisksByVmId(vmExtId, opts)) as { data: any };
  return unwrap(data);
}

export async function listCvmsByClusterId(clusterExtId: string): Promise<unknown> {
  const api = buildCvmsApiClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: any = { '$page': 0, '$limit': 50 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = (await api.listCvmsbyClusterId(clusterExtId, opts)) as { data: any };
  return unwrap(data);
} 

export async function getCvmById(clusterExtId: string, cvmExtId: string): Promise<unknown> {
    
  const api = buildCvmsApiClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = (await api.getCvmById(clusterExtId, cvmExtId)) as { data: any };
  return unwrap(data);
}
