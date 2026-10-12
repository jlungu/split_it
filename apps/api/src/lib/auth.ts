import { createClient } from '@supabase/supabase-js';
import type { Context } from 'hono';
import { supabase } from './supabase.js';

const authClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
  auth: { persistSession: false },
});

// Verifying a token costs a round trip to Supabase Auth plus a users lookup, which every
// request used to pay before doing any work. Cache the result per token for a few minutes
// (never past the token's own expiry).
const TOKEN_TTL = 5 * 60_000;
const tokenCache = new Map<string, { userId: string; email: string; expires: number }>();
// public.users.id for an email never changes once resolved
const userIdByEmail = new Map<string, string>();

function checkAllowlist(email: string | undefined): boolean {
  const allowlist = process.env.ALLOWED_EMAILS;
  if (!allowlist) return true;
  const allowed = allowlist.split(',').map((e) => e.trim().toLowerCase());
  return allowed.includes(email?.toLowerCase() ?? '');
}

// Resolve the public.users.id for an authenticated user.
// For users who were added as placeholders before signing up, their public.users.id
// (an auto-generated UUID) differs from auth.users.id — we resolve by email to stay consistent.
async function resolvePublicUserId(authId: string, email: string): Promise<string> {
  const known = userIdByEmail.get(email);
  if (known) return known;
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single();
  if (data?.id) userIdByEmail.set(email, data.id);
  return data?.id ?? authId;
}

async function authenticate(c: Context): Promise<{ userId: string; email: string } | null> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);

  const now = Date.now();
  const hit = tokenCache.get(token);
  if (hit && hit.expires > now) return { userId: hit.userId, email: hit.email };

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return null;
  if (!checkAllowlist(data.user.email)) return null;
  const email = data.user.email ?? '';
  const userId = await resolvePublicUserId(data.user.id, email);

  // Evict expired entries so the map can't grow without bound
  for (const [t, e] of tokenCache) if (e.expires <= now) tokenCache.delete(t);
  const exp = (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp ?? 0) * 1000;
  tokenCache.set(token, { userId, email, expires: Math.min(now + TOKEN_TTL, exp) });

  return { userId, email };
}

export async function requireAuth(c: Context): Promise<string | null> {
  return (await authenticate(c))?.userId ?? null;
}

export async function requireAuthWithEmail(c: Context): Promise<{ userId: string; email: string } | null> {
  return authenticate(c);
}
