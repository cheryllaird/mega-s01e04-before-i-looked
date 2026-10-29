import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const night = '2026-10-28';
const directories: string[] = [];

async function makeRunsDir(contents?: string) {
  const runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
  directories.push(runsDir);
  if (contents !== undefined) {
    await writeFile(join(runsDir, `${night}.jsonl`), contents, 'utf8');
  }
  return runsDir;
}

function configFor(runsDir: string) {
  return {
    adapter: 'shim' as const,
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  };
}

function rowText(html: string, job: string) {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1] ?? '');
  const row = rows.find((candidate) => stripMarkup(candidate).includes(job));
  expect(row, `expected a table row for ${job}`).toBeDefined();
  return stripMarkup(row ?? '');
}

function renderedJobOrder(html: string) {
  const tbody = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? '';
  return [...tbody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => {
    const firstCell = match[1]?.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? '';
    return stripMarkup(firstCell);
  });
}

function stripMarkup(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&mdash;/gi, '—')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('digest routes', () => {
  it('renders and returns the same sorted mixed-job digest, retaining retries, failures, owners and offsets', async () => {
    const runsDir = await makeRunsDir([
      JSON.stringify({ at: '2026-10-28T08:10:00+01:00', job: 'zeta', status: 'ok', owner: 'Zoe' }),
      JSON.stringify({ at: '2026-10-28T08:00:00+01:00', job: 'alpha', status: 'retry', owner: 'Ada', error: 'first attempt' }),
      JSON.stringify({ at: '2026-10-28T08:00:05+01:00', job: 'alpha', status: 'retry', owner: 'Ada' }),
      JSON.stringify({ at: '2026-10-28T08:00:10+01:00', job: 'alpha', status: 'retry', owner: 'Ada' }),
      JSON.stringify({ at: '2026-10-28T08:00:20+01:00', job: 'alpha', status: 'fail', owner: 'Ada', error: 'connection refused' }),
      JSON.stringify({ at: '2026-10-28T09:15:00+05:30', job: 'gamma', status: 'ok', owner: null }),
    ].join('\n'));
    const app = createApp(configFor(runsDir));

    const [page, api] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    const html = await page.text();
    const digest = await api.json();

    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(digest).toEqual({
      night,
      rows: [
        {
          job: 'alpha',
          owner: 'Ada',
          runs: 4,
          retries: 3,
          lastStatus: 'fail',
          lastError: 'connection refused',
          firstAt: '2026-10-28T08:00:00+01:00',
          lastAt: '2026-10-28T08:00:20+01:00',
        },
        {
          job: 'gamma',
          owner: null,
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-28T09:15:00+05:30',
          lastAt: '2026-10-28T09:15:00+05:30',
        },
        {
          job: 'zeta',
          owner: 'Zoe',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-28T08:10:00+01:00',
          lastAt: '2026-10-28T08:10:00+01:00',
        },
      ],
      badLines: 0,
      counts: { ok: 2, retry: 3, fail: 1 },
    });

    expect(renderedJobOrder(html)).toEqual(digest.rows.map((row: { job: string }) => row.job));
    expect(rowText(html, 'alpha')).toContain('3');
    expect(rowText(html, 'alpha')).toContain('fail');
    expect(rowText(html, 'gamma')).toContain('—');
    expect(html).toContain('2026-10-28T09:15:00+05:30');
  });

  it('returns 404 when the requested night file is missing', async () => {
    const app = createApp(configFor(await makeRunsDir()));

    const [page, api] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);

    expect(page.status).toBe(404);
    expect(api.status).toBe(404);
  });

  it('returns an empty digest and renders “nothing ran” for an empty night', async () => {
    const app = createApp(configFor(await makeRunsDir('')));

    const [page, api] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);

    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({
      night,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
    expect(await page.text()).toContain('nothing ran');
  });

  it('counts malformed lines while rendering and returning the valid rows', async () => {
    const runsDir = await makeRunsDir([
      '{not json',
      JSON.stringify({ at: '2026-10-28T08:30:00-04:00', job: 'still-ran', status: 'ok', owner: null }),
      '{"at": "missing closing brace"',
    ].join('\n'));
    const app = createApp(configFor(runsDir));

    const [page, api] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);

    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    const digest = await api.json();
    const html = await page.text();
    expect(digest).toEqual({
      night,
      rows: [
        {
          job: 'still-ran',
          owner: null,
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-28T08:30:00-04:00',
          lastAt: '2026-10-28T08:30:00-04:00',
        },
      ],
      badLines: 2,
      counts: { ok: 1, retry: 0, fail: 0 },
    });
    expect(html).toContain('still-ran');
    expect(html).toContain('bad lines: 2');
    expect(html).toContain('2026-10-28T08:30:00-04:00');
  });
});
