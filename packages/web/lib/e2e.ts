// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  The end-to-end scheme lives in `@projectx-social/sdk` (`packages/sdk/src/e2e.ts`) since
  2026-09-02, hoisted whole so the agent's mind and a person's messages are encrypted by one
  implementation. This file is a pointer, not a copy: `test/statement-drift.test.ts` asserts the
  symbols are the SDK's own objects.
*/
export {
  KEY_STATEMENT,
  type Envelope,
  type EncryptedPayload,
  toB64,
  fromB64,
  ciphertextDigest,
  deriveSecret,
  publicFromSecret,
  encrypt,
  encryptBytes,
  decrypt,
  decryptBytes,
} from '@projectx-social/sdk';
