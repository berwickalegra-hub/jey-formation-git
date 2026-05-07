import { Redis } from '@upstash/redis';

export interface CreateRedisClientOptions {
  url?: string;
  token?: string;
}

export function createRedisClient(options: CreateRedisClientOptions = {}): Redis {
  const url = options.url ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = options.token ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      'createRedisClient: missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN (set env vars or pass options)',
    );
  }

  return new Redis({ url, token });
}

export type { Redis };
