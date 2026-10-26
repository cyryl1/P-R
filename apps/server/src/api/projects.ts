import type { FastifyInstance } from 'fastify';
import { ApiErrorSchema, ApiSchemas, ProjectSummarySchema, RulesDocumentSchema } from '@pr-reviewer/shared';
import type { DataPaths } from '../config/index.js';
import { deleteRules, getRules, listRules, saveRules, templateFor, validateRulesYaml } from '../rules/index.js';

const errorResponse = (code: 'NO_RULES' | 'RULES_INVALID' | 'VALIDATION_ERROR', message: string, details?: unknown) =>
  ApiErrorSchema.parse({ error: { code, message, ...(details === undefined ? {} : { details }) } });

export function registerProjectRoutes(app: FastifyInstance, paths: DataPaths) {
  app.get('/api/projects', async (_request, reply) => {
    const projects = await listRules(paths);
    return reply.send(projects.map((project) => ProjectSummarySchema.parse(project)));
  });

  app.get('/api/projects/template', async (request, reply) => {
    const query = ApiSchemas.projects.templateQuery.safeParse(request.query);
    if (!query.success || !/^[^/\s]+\/[^/\s]+$/.test(query.data.repo)) return reply.code(400).send(errorResponse('VALIDATION_ERROR', 'Expected repo=owner/name'));
    return reply.send(ApiSchemas.projects.templateResponse.parse({ yaml: templateFor(query.data.repo) }));
  });

  app.post('/api/projects/validate', async (request, reply) => {
    const body = ApiSchemas.projects.validate.safeParse(request.body);
    if (!body.success) return reply.code(400).send(errorResponse('VALIDATION_ERROR', 'Expected a yaml string'));
    return reply.send(ApiSchemas.projects.validateResponse.parse(validateRulesYaml(body.data.yaml)));
  });

  app.get<{ Params: { owner: string; repo: string } }>('/api/projects/:owner/:repo', async (request, reply) => {
    if (!/^[^/\s]+$/.test(request.params.owner) || !/^[^/\s]+$/.test(request.params.repo)) return reply.code(400).send(errorResponse('VALIDATION_ERROR', 'Expected owner/repo path parameters'));
    const repo = `${request.params.owner}/${request.params.repo}`;
    try {
      const document = await getRules(paths, repo);
      return reply.send(RulesDocumentSchema.parse(document));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reply.code(404).send(errorResponse('NO_RULES', `No rules file for ${repo}`));
      throw error;
    }
  });

  app.put<{ Params: { owner: string; repo: string } }>('/api/projects/:owner/:repo', async (request, reply) => {
    const body = ApiSchemas.projects.save.safeParse(request.body);
    if (!body.success) return reply.code(400).send(errorResponse('VALIDATION_ERROR', 'Expected a yaml string'));
    if (!/^[^/\s]+$/.test(request.params.owner) || !/^[^/\s]+$/.test(request.params.repo)) return reply.code(400).send(errorResponse('VALIDATION_ERROR', 'Expected owner/repo path parameters'));
    const repo = `${request.params.owner}/${request.params.repo}`;
    const result = await saveRules(paths, repo, body.data.yaml);
    if (!result.valid) return reply.code(422).send(errorResponse('RULES_INVALID', 'Rules file is invalid and was not saved', result.errors));
    return reply.send(RulesDocumentSchema.parse(result));
  });

  app.delete<{ Params: { owner: string; repo: string } }>('/api/projects/:owner/:repo', async (request, reply) => {
    if (!/^[^/\s]+$/.test(request.params.owner) || !/^[^/\s]+$/.test(request.params.repo)) return reply.code(400).send(errorResponse('VALIDATION_ERROR', 'Expected owner/repo path parameters'));
    const repo = `${request.params.owner}/${request.params.repo}`;
    await deleteRules(paths, repo);
    return reply.code(204).send();
  });
}
