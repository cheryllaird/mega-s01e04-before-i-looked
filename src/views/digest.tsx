import type { DigestNight } from '../digest/types.js';

export function DigestPage({ digest }: { digest: DigestNight }) {
  return (
    <>
      <h1>digest · {digest.night}</h1>
      <p class="digest__bad-lines">bad lines: {digest.badLines}</p>
      {digest.rows.length === 0 ? <p class="mute">nothing ran</p> : null}
      <table class="digest__table">
        <thead>
          <tr>
            <th>job</th>
            <th>owner</th>
            <th>runs</th>
            <th>retries</th>
            <th>last status</th>
            <th>last error</th>
            <th>first at</th>
            <th>last at</th>
          </tr>
        </thead>
        <tbody>
          {digest.rows.map((row) => (
            <tr>
              <td>{row.job}</td>
              <td>{row.owner ?? '—'}</td>
              <td>{row.runs}</td>
              <td class={row.retries >= 3 ? 'warn' : undefined}>{row.retries}</td>
              <td class={row.lastStatus === 'fail' ? 'warn' : undefined}>{row.lastStatus}</td>
              <td>{row.lastError ?? '—'}</td>
              <td>{row.firstAt}</td>
              <td>{row.lastAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
