import { createClient } from '@supabase/supabase-js';
import type { Context } from 'hono';

function makeClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
}

function checkAllowlist(email: string | undefined): boolean {
  const allowlist = process.env.ALLOWED_EMAILS;
  if (!allowlist) return true;
  const allowed = allowlist.split(',').map((e) => e.trim().toLowerCase());
  return allowed.includes(email?.toLowerCase() ?? '');
}

export async function requireAuth(c: Context): Promise<string | null> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const { data, error } = await makeClient().auth.getUser(authHeader.slice(7));
  if (error || !data.user) return null;
  if (!checkAllowlist(data.user.email)) return null;
  return data.user.id;
}

export async function requireAuthWithEmail(c: Context): Promise<{ userId: string; email: string } | null> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const { data, error } = await makeClient().auth.getUser(authHeader.slice(7));
  if (error || !data.user) return null;
  if (!checkAllowlist(data.user.email)) return null;
  return { userId: data.user.id, email: data.user.email ?? '' };
}
