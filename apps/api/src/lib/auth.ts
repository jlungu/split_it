import { createClient } from '@supabase/supabase-js';
import type { Context } from 'hono';

// Verify the JWT from the Authorization header and return the user id
export async function requireAuth(c: Context): Promise<string | null> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
  );

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;

  const allowlist = process.env.ALLOWED_EMAILS;
  if (allowlist) {
    const allowed = allowlist.split(',').map((e) => e.trim().toLowerCase());
    if (!allowed.includes(data.user.email?.toLowerCase() ?? '')) return null;
  }

  return data.user.id;
}
