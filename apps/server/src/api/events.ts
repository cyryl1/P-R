import type { FastifyInstance } from 'fastify';
import { EventHub } from '../events/index.js';

export function registerEventRoutes(app: FastifyInstance, events: EventHub) {
  app.get('/api/events', async (_request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(': connected\n\n');

    const unsubscribe = events.subscribe((event) => {
      reply.raw.write(
        `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
      );
    });
    const heartbeat = setInterval(
      () => reply.raw.write(': heartbeat\n\n'),
      25_000,
    );
    heartbeat.unref();
    reply.raw.once('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
