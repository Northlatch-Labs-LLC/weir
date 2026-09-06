// Built-by: @projectx.sui
/**
 * A `fetch` for the purse that needs no WebAssembly.
 *
 * # The defect this closes
 *
 * The purse runs under `--jitless` with `MemoryDenyWriteExecute=yes` (heron-purse.service), which
 * is the right posture for a process that holds a key: no writable-and-executable memory, ever.
 * `--jitless` also switches WebAssembly off, and node's built-in `fetch` (undici) parses HTTP with
 * llhttp compiled to WebAssembly. So the first time a purse made a network call from inside that
 * posture — Wren's first paid post, 2026-09-06 04:48 UTC, simulating `set_content_price` over the
 * Sui gRPC-web client — it died with `ReferenceError: WebAssembly is not defined`, systemd
 * restarted it, and the beat was refused `purse-unreachable`. Every free post had worked because a
 * publish statement never leaves the process; every paid post would have died the same way.
 *
 * The gRPC-web transport takes its own `fetch` (`GrpcWebOptions.fetch`). This one is built on
 * `node:https` and `node:http`, whose parser is native, and it answers with the global `Response`,
 * whose construction needs no parser. The hardening stays exactly as it is.
 *
 * # What it is, and is not
 *
 * Enough of `fetch` for a gRPC-web unary or server-streaming call: method, headers, a body that is
 * a string, a `Uint8Array` or an `ArrayBuffer`, an abort signal, a streamed response body. No
 * redirects (a fullnode does not redirect, and following one would send the body somewhere else),
 * no credentials, no cache. A request that asks for something outside that is refused, not
 * silently narrowed.
 */

import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';

type FetchInput = string | URL | Request;

function toUrl(input: FetchInput): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

function toHeaders(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const headers = init?.headers;
  if (headers === undefined || headers === null) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const entry of headers as Iterable<[string, string]>) out[entry[0]] = entry[1];
    return out;
  }
  for (const [key, value] of Object.entries(headers)) out[key] = value;
  return out;
}

function toBody(body: RequestInit['body']): Buffer | null {
  if (body === undefined || body === null) return null;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  throw new TypeError('https-fetch: the body must be a string, a Uint8Array or an ArrayBuffer; nothing else is sent');
}

/**
 * The fetch. Same signature as the global, so it drops into `GrpcWebOptions.fetch` unchanged.
 */
export async function httpsFetch(input: FetchInput, init?: RequestInit): Promise<Response> {
  const url = toUrl(input);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError(`https-fetch: refused - ${url.protocol} is not http: or https:`);
  }
  if (init?.redirect !== undefined && init.redirect !== 'error' && init.redirect !== 'manual') {
    throw new TypeError('https-fetch: refused - redirects are not followed');
  }
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = toBody(init?.body);
  const headers = toHeaders(init);
  if (body !== null && headers['content-length'] === undefined) headers['content-length'] = String(body.byteLength);

  const options: RequestOptions = {
    method,
    hostname: url.hostname,
    port: url.port === '' ? undefined : Number(url.port),
    path: `${url.pathname}${url.search}`,
    headers,
  };
  const make = url.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise<Response>((resolve, reject) => {
    const signal = init?.signal ?? null;
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const req = make(options, (res) => {
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) for (const v of value) responseHeaders.append(key, v);
        else responseHeaders.set(key, value);
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          res.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          res.on('end', () => controller.close());
          res.on('error', (error) => controller.error(error));
        },
        cancel() {
          res.destroy();
        },
      });
      const status = res.statusCode ?? 0;
      // A 204/304 may carry no body by the Response contract; everything a fullnode answers has one.
      resolve(new Response(status === 204 || status === 304 ? null : stream, { status, statusText: res.statusMessage ?? '', headers: responseHeaders }));
    });
    req.on('error', reject);
    if (signal !== null) {
      const onAbort = () => {
        req.destroy(abortError());
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      req.on('close', () => signal.removeEventListener('abort', onAbort));
    }
    if (body !== null) req.write(body);
    req.end();
  });
}

function abortError(): Error {
  const error = new Error('https-fetch: the request was aborted');
  error.name = 'AbortError';
  return error;
}

/** True when this process cannot run WebAssembly, which is the purse's normal state. */
export function webAssemblyIsOff(): boolean {
  return typeof (globalThis as { WebAssembly?: unknown }).WebAssembly === 'undefined';
}
