// Built-by: @projectx.sui
/**
 * The purse's WebAssembly-free fetch, run against a local server this file starts, and once more
 * inside a child node started with --jitless -- the exact posture that killed the purse on Wren's
 * first paid post. The global fetch fails in that child; this one must not.
 */
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpsFetch, webAssemblyIsOff } from '../src/https-fetch.js';

let server: Server;
let base = '';
const seen: { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: Buffer }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      if (req.url === '/slow') {
        setTimeout(() => { res.writeHead(200); res.end('late'); }, 500);
        return;
      }
      if (req.url === '/redirect') { res.writeHead(302, { location: '/elsewhere' }); res.end(); return; }
      res.writeHead(201, { 'content-type': 'application/grpc-web+proto', 'x-echo-len': String(body.length) });
      // Two chunks, so the streamed body is exercised rather than a single write.
      res.write(body.subarray(0, Math.ceil(body.length / 2)));
      setTimeout(() => res.end(body.subarray(Math.ceil(body.length / 2))), 20);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { server.close(); });

describe('httpsFetch', () => {
  it('sends method, headers and a binary body, and streams the response back with status and headers', async () => {
    const bytes = new Uint8Array([0, 0, 0, 0, 3, 8, 1, 16]);
    const response = await httpsFetch(`${base}/sui.rpc.v2.LedgerService/GetObject`, {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1' }),
      body: bytes,
      signal: null as unknown as AbortSignal,
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('application/grpc-web+proto');
    expect(response.body).not.toBeNull();
    const back = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(back)).toEqual(Array.from(bytes));
    const last = seen[seen.length - 1]!;
    expect(last.method).toBe('POST');
    expect(last.url).toBe('/sui.rpc.v2.LedgerService/GetObject');
    expect(last.headers['x-grpc-web']).toBe('1');
    expect(last.headers['content-length']).toBe('8');
  });

  it('refuses to follow a redirect rather than sending the body somewhere else', async () => {
    const response = await httpsFetch(`${base}/redirect`, { method: 'POST', body: 'x' });
    expect(response.status).toBe(302);
    expect(seen.filter((s) => s.url === '/elsewhere')).toHaveLength(0);
    await expect(httpsFetch(`${base}/redirect`, { redirect: 'follow' })).rejects.toThrow(/redirects are not followed/);
  });

  it('refuses a protocol that is not http or https, and a body shape it does not send', async () => {
    await expect(httpsFetch('ftp://127.0.0.1/x')).rejects.toThrow(/not http: or https:/);
    await expect(httpsFetch(`${base}/x`, { method: 'POST', body: new FormData() })).rejects.toThrow(/must be a string/);
  });

  it('honours an abort signal', async () => {
    const controller = new AbortController();
    const pending = httpsFetch(`${base}/slow`, { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('works inside node --jitless, where the global fetch cannot parse HTTP', async () => {
    const script = `
      import { httpsFetch } from ${JSON.stringify(fileURLToPath(new URL('../src/https-fetch.ts', import.meta.url)))};
      const wasmOff = typeof WebAssembly === 'undefined';
      let globalFailed = false;
      try { await fetch(process.argv[1] + '/ping', { method: 'POST', body: 'g' }); } catch { globalFailed = true; }
      const r = await httpsFetch(process.argv[1] + '/ping', { method: 'POST', body: 'jitless' });
      const text = await r.text();
      process.stdout.write(JSON.stringify({ wasmOff, globalFailed, status: r.status, text }));
    `;
    const child = spawn(process.execPath, ['--jitless', '--import', 'tsx', '--input-type=module', '-e', script, base], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    const [code] = (await once(child, 'exit')) as [number];
    expect(code, err).toBe(0);
    const result = JSON.parse(out) as { wasmOff: boolean; globalFailed: boolean; status: number; text: string };
    expect(result.wasmOff).toBe(true);
    expect(result.status).toBe(201);
    expect(result.text).toBe('jitless');
    // The finding itself, reproduced: the global fetch is what dies under --jitless.
    expect(result.globalFailed).toBe(true);
  }, 30_000);

  it('reports whether WebAssembly is off in this process (it is on, in the test runner)', () => {
    expect(webAssemblyIsOff()).toBe(false);
  });
});
