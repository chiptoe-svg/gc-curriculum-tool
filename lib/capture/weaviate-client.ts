import weaviate, { type WeaviateClient } from 'weaviate-client';

let client: WeaviateClient | null = null;

/** Lazy-singleton client connected to the local Weaviate. Anonymous mode
 *  when WEAVIATE_API_KEY is empty. The connection is cached for the life
 *  of the process; call closeWeaviateClient() to release it. */
export async function getWeaviateClient(): Promise<WeaviateClient> {
  if (client) return client;
  const httpUrl = process.env.WEAVIATE_URL?.trim();
  if (!httpUrl) throw new Error('WEAVIATE_URL not set');
  const url = new URL(httpUrl);
  const grpcUrl = process.env.WEAVIATE_GRPC_URL?.trim() ?? '127.0.0.1:50051';
  const [grpcHost, grpcPortStr] = grpcUrl.split(':');
  const apiKey = process.env.WEAVIATE_API_KEY?.trim();

  client = await weaviate.connectToCustom({
    httpHost: url.hostname,
    httpPort: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    httpSecure: url.protocol === 'https:',
    grpcHost: grpcHost ?? '127.0.0.1',
    grpcPort: Number(grpcPortStr ?? '50051'),
    grpcSecure: false,
    ...(apiKey ? { authCredentials: new weaviate.ApiKey(apiKey) } : {}),
  });
  return client;
}

export async function closeWeaviateClient(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}
