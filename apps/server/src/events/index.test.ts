import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { RulesFileSchema, type ServerEvent } from '@pr-reviewer/shared';
import { registerActivityRoutes } from '../api/activity.js';
import { registerEventRoutes } from '../api/events.js';
import { ReviewDatabase } from '../db/index.js';
import type { GhPr } from '../gh/client.js';
import { EventHub } from './index.js';

const databases: ReviewDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('server events and activity', () => {
  it('streams named SSE events', async () => {
    const app = Fastify();
    const events = new EventHub();
    registerEventRoutes(app, events);
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const response = await fetch(`${address}/api/events`, {
      signal: controller.signal,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    await reader.read();

    events.publish({ type: 'inbox.updated', data: { count: 3 } });
    const chunk = await reader.read();
    const text = decoder.decode(chunk.value);
    expect(text).toContain('event: inbox.updated');
    expect(text).toContain('data: {"count":3}');

    controller.abort();
    await app.close();
  });

  it('emits database changes and paginates the activity endpoint', async () => {
    const database = await ReviewDatabase.open(':memory:');
    databases.push(database);
    const events: ServerEvent[] = [];
    database.setEventSink((event) => events.push(event));
    const pr: GhPr = {
      number: 2,
      title: 'SSE review',
      body: 'Review body',
      author: { login: 'octo' },
      url: 'https://github.com/acme/events/pull/2',
      baseRefName: 'main',
      headRefName: 'events',
      headRefOid: 'abc',
      isDraft: false,
      additions: 1,
      deletions: 0,
      files: [],
      closingIssuesReferences: [],
      state: 'OPEN',
    };
    const prId = await database.upsertPr('acme/events', pr);
    const review = await database.createReview({
      prId,
      headSha: pr.headRefOid,
      trigger: 'manual',
      rules: RulesFileSchema.parse({
        version: 1,
        repo: 'acme/events',
        enabled: true,
      }),
    });
    await database.updateReview(review.id, { status: 'gathering' });
    await database.addActivity({
      level: 'info',
      type: 'test.activity',
      message: 'Activity one',
      reviewId: review.id,
    });
    await database.addActivity({
      level: 'warn',
      type: 'test.activity',
      message: 'Activity two',
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'review.updated' }),
        expect.objectContaining({ type: 'activity.created' }),
      ]),
    );

    const app = Fastify();
    registerActivityRoutes(app, database);
    const first = await app.inject({
      method: 'GET',
      url: '/api/activity?limit=1',
    });
    expect(first.statusCode).toBe(200);
    const page = first.json() as {
      items: Array<{ message: string }>;
      nextCursor: string;
    };
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    const second = await app.inject({
      method: 'GET',
      url: `/api/activity?limit=1&cursor=${page.nextCursor}`,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().items).toHaveLength(1);
    await app.close();
  });
});
