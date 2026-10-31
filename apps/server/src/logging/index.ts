import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';
import pino, { type Logger } from 'pino';

export type RotatingLogOptions = {
  maxBytes?: number;
  backups?: number;
};

export class RotatingLogStream extends Writable {
  private size: number;
  private readonly maxBytes: number;
  private readonly backups: number;

  constructor(
    private readonly path: string,
    options: RotatingLogOptions = {},
  ) {
    super();
    mkdirSync(dirname(path), { recursive: true });
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
    this.backups = options.backups ?? 5;
    this.size = existsSync(path) ? statSync(path).size : 0;
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    try {
      const bytes = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk, encoding);
      if (this.size > 0 && this.size + bytes.length > this.maxBytes)
        this.rotate();
      appendFileSync(this.path, bytes, { mode: 0o600 });
      this.size += bytes.length;
      callback();
    } catch (error) {
      callback(
        error instanceof Error ? error : new Error('Failed to write log'),
      );
    }
  }

  private rotate() {
    if (this.backups > 0) {
      rmSync(`${this.path}.${this.backups}`, { force: true });
      for (let index = this.backups - 1; index >= 1; index -= 1) {
        const source = `${this.path}.${index}`;
        if (existsSync(source)) renameSync(source, `${this.path}.${index + 1}`);
      }
      if (existsSync(this.path)) renameSync(this.path, `${this.path}.1`);
    } else {
      rmSync(this.path, { force: true });
    }
    this.size = 0;
  }
}

export function createFileLogger(
  logsDirectory: string,
  options: RotatingLogOptions & { level?: string } = {},
): Logger {
  const stream = new RotatingLogStream(
    join(logsDirectory, 'server.log'),
    options,
  );
  return pino(
    { level: options.level ?? 'info' },
    pino.multistream([{ stream: process.stdout }, { stream }]),
  );
}
