export class GhError extends Error {
  constructor(message: string, readonly stderr = '', options?: ErrorOptions) {
    super(message, options);
    this.name = 'GhError';
  }
}

export class GhAuthError extends GhError {
  constructor(message = 'GitHub CLI is not authenticated', stderr = '') {
    super(message, stderr);
    this.name = 'GhAuthError';
  }
}

export class GhNotFoundError extends GhError {
  constructor(message = 'GitHub resource was not found', stderr = '') {
    super(message, stderr);
    this.name = 'GhNotFoundError';
  }
}

export class GhRateLimitError extends GhError {
  constructor(message = 'GitHub API rate limit reached', stderr = '') {
    super(message, stderr);
    this.name = 'GhRateLimitError';
  }
}

export function mapGhError(error: unknown): GhError {
  if (error instanceof GhError) return error;
  const candidate = error as { message?: string; stderr?: string; shortMessage?: string };
  const stderr = candidate?.stderr ?? '';
  const message = candidate?.shortMessage ?? candidate?.message ?? 'GitHub CLI command failed';
  const combined = `${message}\n${stderr}`;
  if (/not logged in|not logged into|not authenticated|authentication required|please run gh auth login/i.test(combined)) {
    return new GhAuthError(message, stderr);
  }
  if (/HTTP 404|Not Found|could not resolve to a repository/i.test(combined)) {
    return new GhNotFoundError(message, stderr);
  }
  if (/rate limit|API rate limit exceeded|secondary rate limit/i.test(combined)) {
    return new GhRateLimitError(message, stderr);
  }
  return new GhError(message, stderr, { cause: error });
}
