// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { z } from 'zod';
import type { Refusal } from './outcome.js';

export const requestSchema = z.strictObject({
  intent: z.unknown(),
});

export type SignedResponse = {
  readonly ok: true;
  readonly digest: string;
  readonly txBytesB64: string;
  readonly signature: string;
};

export type StatementResponse = {
  readonly ok: true;
  readonly statement: string;
  readonly statementSha256: string;
  readonly signature: string;
  readonly address: string;
  readonly timestampMs: number;
};
export type RefusedResponse = {
  readonly ok: false;
  readonly refused: Refusal;
};

export type PurseResponse = SignedResponse | StatementResponse | RefusedResponse;

export const MAX_REQUEST_BYTES = 256 * 1024;
