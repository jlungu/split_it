import { createClient } from '@supabase/supabase-js';
import type { Context } from 'hono';
import { supabase } from './supabase.js';

function makeClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
}

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
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single();
  return data?.id ?? authId;
}

export async function requireAuth(c: Context): Promise<string | null> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const { data, error } = await makeClient().auth.getUser(authHeader.slice(7));
  if (error || !data.user) return null;
  if (!checkAllowlist(data.user.email)) return null;
  return resolvePublicUserId(data.user.id, data.user.email ?? '');
}

export async function requireAuthWithEmail(c: Context): Promise<{ userId: string; email: string } | null> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const { data, error } = await makeClient().auth.getUser(authHeader.slice(7));
  if (error || !data.user) return null;
  if (!checkAllowlist(data.user.email)) return null;
  const email = data.user.email ?? '';
  const userId = await resolvePublicUserId(data.user.id, email);
  return { userId, email };
}
