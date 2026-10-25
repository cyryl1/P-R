import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createServer } from '../index.js';
import type { DataPaths } from '../config/index.js';
import type { GhClient } from '../gh/client.js';

const root = await mkdtemp(join(tmpdir(), 'pr-reviewer-api-'));
const paths: DataPaths = { home: root, rules: join(root, 'rules'), database: join(root, 'data.db'), logs: join(root, 'logs'), config: join(root, 'config.yml') };
const gh = { authStatus: async () => ({ login: 'octocat' }) } as GhClient;
const app = createServer({ paths, gh });
afterAll(async () => app.close());

describe('project API', () => {
  it('lists projects and returns the repo-specific template', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/projects', headers: { host: 'localhost' } });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([]);
    const template = await app.inject({ method: 'GET', url: '/api/projects/template?repo=acme%2Fbilling', headers: { host: 'localhost' } });
    expect(template.statusCode).toBe(200);
    expect(template.json().yaml).toContain('repo: acme/billing');
  });

  it('validates, saves, reads, and deletes projects with the shared response contract', async () => {
    const yaml = 'version: 1\nrepo: acme/billing\nrules: []\n';
    const validate = await app.inject({ method: 'POST', url: '/api/projects/validate', payload: { yaml }, headers: { host: 'localhost' } });
    expect(validate.statusCode).toBe(200);
    expect(validate.json()).toMatchObject({ valid: true, errors: [], parsed: { repo: 'acme/billing', version: 1 } });
    const save = await app.inject({ method: 'PUT', url: '/api/projects/acme/billing', payload: { yaml }, headers: { host: 'localhost' } });
    expect(save.statusCode).toBe(200);
    expect(save.json()).toMatchObject({ repo: 'acme/billing', valid: true, yaml });
    const get = await app.inject({ method: 'GET', url: '/api/projects/acme/billing', headers: { host: 'localhost' } });
    expect(get.statusCode).toBe(200);
    const invalid = await app.inject({ method: 'PUT', url: '/api/projects/acme/billing', payload: { yaml: yaml.replace('acme/billing', 'acme/other') }, headers: { host: 'localhost' } });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.code).toBe('RULES_INVALID');
    const remove = await app.inject({ method: 'DELETE', url: '/api/projects/acme/billing', headers: { host: 'localhost' } });
    expect(remove.statusCode).toBe(204);
  });
});
