import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const tempDirs: string[] = [];

function makeRunsDir() {
  const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-board-'));
  tempDirs.push(runsDir);
  return runsDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('digest status board', () => {
  it('links each night and shows counts of valid events by status', async () => {
    const runsDir = makeRunsDir();
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), [
      JSON.stringify({ at: '2026-10-28T08:00:00+01:00', job: 'build', status: 'ok', owner: 'Ada' }),
      JSON.stringify({ at: '2026-10-28T08:01:00+01:00', job: 'build', status: 'retry', owner: 'Ada' }),
      JSON.stringify({ at: '2026-10-28T08:02:00+01:00', job: 'deploy', status: 'fail', owner: null }),
      JSON.stringify({ at: '2026-10-28T08:03:00+01:00', job: 'deploy', status: 'ok', owner: null }),
      '{bad line',
    ].join('\n'));
    writeFileSync(join(runsDir, '2026-10-27.jsonl'), '');

    const response = await createApp({
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir,
    }).request('/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('ok 2');
    expect(html).toContain('retry 1');
    expect(html).toContain('fail 1');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a>');
    expect(html).toContain('ok 0');
    expect(html).toContain('retry 0');
    expect(html).toContain('fail 0');
  });
});
