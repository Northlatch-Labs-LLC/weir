/**
 * C-01 Fix: Recovery phrase endpoint
 *
 * POST /auth/zklogin/recover
 *   Body: { email, recoveryPhrase }
 *   Returns: { sessionToken }  (or error if phrase wrong)
 *
 * Wire this into your Express/Fastify/Hono router.
 * Adjust userRepo / sessionService imports to match your project.
 */

import type { Request, Response } from "express"; // swap for your framework
import { decryptSeed } from "./zklogin-seed-crypto";
// import { userRepo }       from "../db/user-repo";        // ← your import
// import { sessionService } from "../auth/session-service"; // ← your import

const MAX_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 min

// In-memory rate limiter — swap for Redis in production
const attemptMap = new Map<string, { count: number; since: number }>();

function checkRateLimit(userId: string): void {
  const now = Date.now();
  const entry = attemptMap.get(userId);
  if (!entry || now - entry.since > LOCKOUT_WINDOW_MS) {
    attemptMap.set(userId, { count: 1, since: now });
    return;
  }
  entry.count++;
  if (entry.count > MAX_ATTEMPTS) {
    throw new Error("Too many recovery attempts. Try again in 15 minutes.");
  }
}

export async function recoverZkLoginHandler(req: Request, res: Response) {
  const { email, recoveryPhrase } = req.body as {
    email?: string;
    recoveryPhrase?: string;
  };

  if (!email || !recoveryPhrase) {
    return res.status(400).json({ error: "email and recoveryPhrase required" });
  }

  // 1. Find user
  const user = await userRepo.findByEmail(email);
  if (!user) {
    // Constant-time response to prevent email enumeration
    await new Promise((r) => setTimeout(r, 300));
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // 2. Rate-limit per user
  try {
    checkRateLimit(user.id);
  } catch (e: any) {
    return res.status(429).json({ error: e.message });
  }

  // 3. Decrypt seed
  let rawSeed: string;
  try {
    if (!user.zkloginSeedBlob) throw new Error("No seed blob");
    const blob = JSON.parse(user.zkloginSeedBlob);
    rawSeed = decryptSeed(blob, recoveryPhrase);
  } catch {
    return res.status(401).json({ error: "Invalid recovery phrase" });
  }

  // 4. Clear rate-limit on success
  attemptMap.delete(user.id);

  // 5. Create session (same as normal login)
  const sessionToken = await sessionService.createSession(user, rawSeed);
  return res.status(200).json({ sessionToken });
}
