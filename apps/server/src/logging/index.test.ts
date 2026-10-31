import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RotatingLogStream } from './index.js';

const write = (stream: RotatingLogStream, value: string) =>
  new Promise<void>((resolve, reject) =>
    stream.write(value, (error) => (error ? reject(error) : resolve())),
  );

describe('rotating logs', () => {
  it('keeps bounded backup files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pr-reviewer-logs-'));
    const path = join(directory, 'server.log');
    const stream = new RotatingLogStream(path, { maxBytes: 8, backups: 2 });

    await write(stream, 'first\n');
    await write(stream, 'second\n');
    await write(stream, 'third\n');

    expect(await readFile(path, 'utf8')).toBe('third\n');
    expect(await readFile(`${path}.1`, 'utf8')).toBe('second\n');
    expect(await readFile(`${path}.2`, 'utf8')).toBe('first\n');
  });
});
