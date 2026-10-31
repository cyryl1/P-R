import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ApiErrorSchema } from '@pr-reviewer/shared';

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function sendFile(reply: FastifyReply, path: string, cache: string) {
  const body = await readFile(path);
  return reply
    .header('cache-control', cache)
    .type(
      contentTypes[extname(path).toLowerCase()] ?? 'application/octet-stream',
    )
    .send(body);
}

export function registerProductionWeb(app: FastifyInstance, webDist: string) {
  const root = resolve(webDist);
  const index = resolve(root, 'index.html');
  if (!existsSync(index))
    throw new Error(
      `Production web build not found at ${index}. Run "pnpm build" first.`,
    );

  const handler = async (
    request: { params: { '*': string }; url: string },
    reply: FastifyReply,
  ) => {
    const requested = request.params['*'] ?? '';
    if (requested === 'api' || requested.startsWith('api/'))
      return reply.code(404).send(
        ApiErrorSchema.parse({
          error: { code: 'INTERNAL', message: 'API endpoint not found' },
        }),
      );
    const path = resolve(root, requested);
    const insideRoot = path === root || path.startsWith(`${root}${sep}`);
    if (insideRoot && requested) {
      try {
        if ((await stat(path)).isFile())
          return sendFile(
            reply,
            path,
            requested.startsWith('assets/')
              ? 'public, max-age=31536000, immutable'
              : 'public, max-age=3600',
          );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    if (extname(requested)) return reply.code(404).send('Not found');
    return sendFile(reply, index, 'no-cache');
  };

  app.get('/', async (_request, reply) => sendFile(reply, index, 'no-cache'));
  app.get<{ Params: { '*': string } }>('/*', handler);
}
