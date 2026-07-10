import { randomUUID } from 'crypto';
import { Hono } from 'hono';
import type { User } from '@split-it/types';
import { requireAuth, requireAuthWithEmail } from '../lib/auth.js';
import { supabase } from '../lib/supabase.js';

const router = new Hono();

// Search users by name or email (partial match)
router.get('/search', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const q = c.req.query('q')?.trim();
  if (!q || q.length < 1) return c.json({ users: [] });

  const { data, error } = await supabase
    .from('users')
    .select('id, email, display_name, venmo_handle, zelle_contact, is_registered')
    .or(`email.ilike.%${q}%,display_name.ilike.%${q}%`)
    .neq('id', userId)
    .limit(6);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ users: data ?? [] });
});

// Get or create a user by email (creates placeholder if not found)
router.post('/find-or-create', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const { email } = await c.req.json<{ email: string }>();
  if (!email) return c.json({ error: 'email is required' }, 400);
  const normalised = email.toLowerCase().trim();

  const { data: existing } = await supabase
    .from('users')
    .select('id, email, display_name, venmo_handle, zelle_contact, is_registered')
    .eq('email', normalised)
    .maybeSingle();

  if (existing) return c.json({ user: existing });

  const { data: created, error } = await supabase
    .from('users')
    .insert({ email: normalised, is_registered: false })
    .select('id, email, display_name, venmo_handle, zelle_contact, is_registered')
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ user: created }, 201);
});

// Create a named guest (no email needed — generates a placeholder)
router.post('/guest', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const { display_name } = await c.req.json<{ display_name: string }>();
  if (!display_name?.trim()) return c.json({ error: 'display_name is required' }, 400);

  const placeholder = `guest-${randomUUID()}@split-it.local`;
  const { data, error } = await supabase
    .from('users')
    .insert({ email: placeholder, display_name: display_name.trim(), is_registered: false })
    .select('id, email, display_name, venmo_handle, zelle_contact, is_registered')
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ user: data as User }, 201);
});

// Get the authenticated user's profile
router.get('/me', async (c) => {
  const auth = await requireAuthWithEmail(c);
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);

  const cols = 'id, email, display_name, venmo_handle, zelle_contact, is_registered';

  // Try to find by auth user id
  const { data: existing } = await supabase
    .from('users').select(cols).eq('id', auth.userId).single();
  if (existing) return c.json({ user: existing as User });

  // Try to find by email (placeholder created before they signed up)
  const { data: byEmail } = await supabase
    .from('users').select(cols).eq('email', auth.email).single();
  if (byEmail) return c.json({ user: byEmail as User });

  // Brand new user — create them
  const { data: created, error } = await supabase
    .from('users')
    .insert({ id: auth.userId, email: auth.email, is_registered: true })
    .select(cols).single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ user: created as User });
});

// Update the authenticated user's profile
router.put('/me', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const { display_name, venmo_handle, zelle_contact } = await c.req.json<
    Pick<User, 'display_name' | 'venmo_handle' | 'zelle_contact'>
  >();

  const { data, error } = await supabase
    .from('users')
    .update({ display_name, venmo_handle, zelle_contact })
    .eq('id', userId)
    .select('id, email, display_name, venmo_handle, zelle_contact, is_registered')
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ user: data as User });
});

export default router;
