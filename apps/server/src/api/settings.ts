import type { FastifyInstance } from 'fastify';
import {
  ApiErrorSchema,
  ApiSchemas,
  AppConfigSchema,
  type AppConfig,
} from '@pr-reviewer/shared';
import { stringify } from 'yaml';
import { saveConfigYaml, type DataPaths } from '../config/index.js';

const validationError = (details: unknown) =>
  ApiErrorSchema.parse({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid settings',
      details,
    },
  });

type SettingsPatch = {
  [Key in keyof AppConfig]?: Partial<AppConfig[Key]> | undefined;
};

export class SettingsService {
  constructor(
    private readonly paths: DataPaths,
    private current: AppConfig,
    private readonly onUpdate?: (config: AppConfig) => void,
  ) {}

  get(): AppConfig {
    return this.current;
  }

  async update(patch: SettingsPatch): Promise<AppConfig> {
    const next = AppConfigSchema.parse({
      server: { ...this.current.server, ...patch.server },
      poller: { ...this.current.poller, ...patch.poller },
      llm: { ...this.current.llm, ...patch.llm },
      jobs: { ...this.current.jobs, ...patch.jobs },
    });
    await saveConfigYaml(this.paths.config, stringify(next));
    this.current = next;
    this.onUpdate?.(next);
    return next;
  }
}

export function registerSettingsRoutes(
  app: FastifyInstance,
  settings: SettingsService,
) {
  app.get('/api/settings', async (_request, reply) =>
    reply.send(ApiSchemas.settings.response.parse(settings.get())),
  );

  app.put('/api/settings', async (request, reply) => {
    const body = ApiSchemas.settings.update.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send(validationError(body.error.flatten()));
    try {
      return reply.send(
        ApiSchemas.settings.response.parse(
          await settings.update(request.body as SettingsPatch),
        ),
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError')
        return reply.code(400).send(validationError(error.message));
      throw error;
    }
  });
}
