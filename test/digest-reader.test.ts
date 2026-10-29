import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

describe('readNight', () => {
  let runsDir: string;
  const night = '2026-10-28';
  const event = {
    at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook',
  };

  beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-')); });
  afterEach(() => { rmSync(runsDir, { recursive: true, force: true }); });

  function writeEvents(events: unknown[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), events.map(value => JSON.stringify(value)).join('\n'));
  }

  it('reads the real night without dropping ownerless jobs or retry history', () => {
    const digest = readNight(resolve('runs'), night);
    expect(digest?.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows[0]).toMatchObject({ owner: null, runs: 1, retries: 0 });
    expect(digest?.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok',
      lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(digest?.rows[2]).toMatchObject({ runs: 8, retries: 1, lastError: 'lock held' });
    expect(digest?.rows[3]).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('returns null for a missing night and an empty digest for an empty file', () => {
    expect(readNight(runsDir, night)).toBeNull();
    writeFileSync(join(runsDir, `${night}.jsonl`), '');
    expect(readNight(runsDir, night)).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it.each(['../2026-10-28', '..\\2026-10-28', '2026-10-28/extra', '2026-10-28.jsonl', '2026-02-29', '2026-13-01', '2026-1-01', ''])('rejects invalid night %j', invalid => {
    expect(readNight(runsDir, invalid)).toBeNull();
  });

  it('accepts leap days that exist', () => {
    writeFileSync(join(runsDir, '2024-02-29.jsonl'), '');
    expect(readNight(runsDir, '2024-02-29')?.rows).toEqual([]);
  });

  it('counts invalid JSON and invalid event records while retaining valid neighbours', () => {
    const invalid: unknown[] = [
      null, [], 1, 'event', {},
      { ...event, at: undefined }, { ...event, job: undefined },
      { ...event, status: undefined }, { ...event, owner: undefined },
      { ...event, at: 123 }, { ...event, at: 'yesterday' },
      { ...event, at: '2026-10-28T23:00:00' }, { ...event, at: '2026-02-30T23:00:00Z' },
      { ...event, at: '2026-10-28T24:00:00Z' }, { ...event, at: '2026-10-28T23:60:00Z' },
      { ...event, job: 123 }, { ...event, job: ' ' }, { ...event, status: 'unknown' },
      { ...event, owner: 123 }, { ...event, error: null }, { ...event, error: {} },
    ];
    writeFileSync(join(runsDir, `${night}.jsonl`), [
      JSON.stringify(event), ...invalid.map(value => JSON.stringify(value)), '{broken', '',
      JSON.stringify({ ...event, owner: null }), '',
    ].join('\r\n'));
    expect(readNight(runsDir, night)).toMatchObject({
      badLines: invalid.length + 2, counts: { ok: 2, retry: 0, fail: 0 },
      rows: [{ job: 'job', owner: null, runs: 2, lastError: null }],
    });
  });

  it('aggregates unsorted events by instant and retains their original offset timestamps', () => {
    writeEvents([
      { ...event, at: '2026-10-29T01:00:00+00:00', owner: null },
      { ...event, at: '2026-10-29T01:30:00+02:00', status: 'retry', error: 'earlier error' },
      { ...event, at: '2026-10-28T20:15:00-04:00', status: 'fail', error: 'latest error' },
      { ...event, at: '2026-10-29T00:45:00Z', status: 'retry', error: '' },
      { ...event, at: '2026-10-29T00:50:00Z', error: '   ' },
      { ...event, job: 'another', owner: null },
    ]);
    expect(readNight(runsDir, night)).toEqual({
      night, badLines: 0, counts: { ok: 3, retry: 2, fail: 1 },
      rows: [
        { job: 'another', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt: event.at, lastAt: event.at },
        {
          job: 'job', owner: null, runs: 5, retries: 2, lastStatus: 'ok', lastError: 'latest error',
          firstAt: '2026-10-29T01:30:00+02:00', lastAt: '2026-10-29T01:00:00+00:00',
        },
      ],
    });
  });

  it('uses the later log entry when events have the same instant', () => {
    writeEvents([
      { ...event, status: 'fail', error: 'first error' },
      { ...event, at: '2026-10-28T22:00:00Z', status: 'retry', owner: null, error: 'second error' },
    ]);
    expect(readNight(runsDir, night)?.rows).toEqual([{
      job: 'job', owner: null, runs: 2, retries: 1, lastStatus: 'retry', lastError: 'second error',
      firstAt: event.at, lastAt: '2026-10-28T22:00:00Z',
    }]);
  });
});
