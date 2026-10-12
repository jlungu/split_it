import { Hono } from 'hono';
import type { BalanceSummary, GroupSummary } from '@split-it/types';
import { requireAuth } from '../lib/auth.js';
import { loadReceiptShares } from '../lib/split.js';
import { supabase } from '../lib/supabase.js';

const router = new Hono();

// ── helpers ──────────────────────────────────────────────────────────────────

async function assertMember(groupId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('group_members')
    .select('id')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .single();
  return !!data;
}

type BalanceMaps = { owedToMe: Map<string, number>; iOwe: Map<string, number> };

// Compute per-peer balance maps scoped to a set of receipt IDs (same logic as splits/balances)
async function computeBalancesForReceipts(userId: string, receiptIds: string[]): Promise<BalanceMaps> {
  const owedToMe = new Map<string, number>();
  const iOwe = new Map<string, number>();
  if (!receiptIds.length) return { owedToMe, iOwe };

  const [shares, { data: sFrom }, { data: sTo }] = await Promise.all([
    loadReceiptShares(receiptIds),
    supabase.from('settlements').select('to_user_id, amount').eq('from_user_id', userId).in('receipt_id', receiptIds).not('paid_at', 'is', null),
    supabase.from('settlements').select('from_user_id, amount').eq('to_user_id', userId).in('receipt_id', receiptIds).not('paid_at', 'is', null),
  ]);

  for (const r of shares.values()) {
    if (r.owner_id === userId) {
      // Others owe me on receipts I own
      for (const [uid, amt] of r.totals) {
        if (uid !== userId) owedToMe.set(uid, (owedToMe.get(uid) ?? 0) + amt);
      }
    } else {
      // I owe the owner on receipts I'm assigned to
      const amt = r.totals.get(userId);
      if (amt) iOwe.set(r.owner_id, (iOwe.get(r.owner_id) ?? 0) + amt);
    }
  }

  // Apply settlements
  for (const s of sFrom ?? []) iOwe.set(s.to_user_id, Math.max(0, (iOwe.get(s.to_user_id) ?? 0) - s.amount));
  for (const s of sTo ?? []) owedToMe.set(s.from_user_id, Math.max(0, (owedToMe.get(s.from_user_id) ?? 0) - s.amount));

  return { owedToMe, iOwe };
}

async function buildBalanceSummaries(
  userId: string,
  { owedToMe, iOwe }: BalanceMaps
): Promise<BalanceSummary[]> {
  const peerIds = [...new Set([...owedToMe.keys(), ...iOwe.keys()])];
  if (!peerIds.length) return [];

  const { data: users } = await supabase
    .from('users')
    .select('id, email, display_name, venmo_handle, zelle_contact')
    .in('id', peerIds);

  return peerIds
    .map((pid) => {
      const peer = (users ?? []).find((u) => u.id === pid);
      const theyOwe = owedToMe.get(pid) ?? 0;
      const youOwe = iOwe.get(pid) ?? 0;
      const net = Number((theyOwe - youOwe).toFixed(2));
      return {
        peer_user_id: pid,
        peer_email: peer?.email ?? '',
        peer_display_name: peer?.display_name ?? null,
        peer_venmo_handle: peer?.venmo_handle ?? null,
        peer_zelle_contact: peer?.zelle_contact ?? null,
        net_amount: net,
        you_owe: youOwe > theyOwe ? Number((youOwe - theyOwe).toFixed(2)) : 0,
        they_owe: theyOwe > youOwe ? Number((theyOwe - youOwe).toFixed(2)) : 0,
      };
    })
    .filter((b) => b.net_amount !== 0 || b.you_owe > 0 || b.they_owe > 0);
}

// ── routes ────────────────────────────────────────────────────────────────────

// List all groups the user belongs to, with balance summaries
router.get('/', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const { data: memberRows } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', userId);

  const groupIds = (memberRows ?? []).map((r) => r.group_id);
  if (!groupIds.length) return c.json({ groups: [] });

  const [{ data: groups }, { data: allMembers }, { data: allReceipts }] = await Promise.all([
    supabase.from('groups').select('id, name, created_by, created_at').in('id', groupIds),
    supabase.from('group_members').select('group_id, user_id, users(id, email, display_name)').in('group_id', groupIds),
    supabase.from('receipts').select('id, group_id').in('group_id', groupIds),
  ]);

  // Bucket receipt IDs by group
  const receiptIdsByGroup = new Map<string, string[]>();
  for (const r of allReceipts ?? []) {
    if (!r.group_id) continue;
    if (!receiptIdsByGroup.has(r.group_id)) receiptIdsByGroup.set(r.group_id, []);
    receiptIdsByGroup.get(r.group_id)!.push(r.id);
  }

  // Each group's balances are independent — compute them concurrently
  const summaries: GroupSummary[] = await Promise.all((groups ?? []).map(async (g) => {
    const receiptIds = receiptIdsByGroup.get(g.id) ?? [];
    const { owedToMe, iOwe } = await computeBalancesForReceipts(userId, receiptIds);

    const theyOweTotal = [...owedToMe.values()].reduce((s, v) => s + Math.max(0, v), 0);
    const iOweTotal = [...iOwe.values()].reduce((s, v) => s + Math.max(0, v), 0);

    const members = (allMembers ?? [])
      .filter((m) => m.group_id === g.id)
      .map((m) => m.users as unknown as { id: string; email: string; display_name: string | null });

    return {
      id: g.id,
      name: g.name,
      created_by: g.created_by,
      created_at: g.created_at,
      member_count: members.length,
      they_owe: theyOweTotal > iOweTotal ? Number((theyOweTotal - iOweTotal).toFixed(2)) : 0,
      you_owe: iOweTotal > theyOweTotal ? Number((iOweTotal - theyOweTotal).toFixed(2)) : 0,
      members,
    };
  }));

  return c.json({ groups: summaries });
});

// Create a new group; auto-add creator as a member
router.post('/', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const { name } = await c.req.json<{ name: string }>();
  if (!name?.trim()) return c.json({ error: 'name is required' }, 400);

  const { data: group, error: ge } = await supabase
    .from('groups')
    .insert({ name: name.trim(), created_by: userId })
    .select()
    .single();

  if (ge) return c.json({ error: ge.message }, 500);

  const { error: me } = await supabase
    .from('group_members')
    .insert({ group_id: group.id, user_id: userId });

  if (me) {
    await supabase.from('groups').delete().eq('id', group.id);
    return c.json({ error: `Failed to add creator as member: ${me.message}` }, 500);
  }

  return c.json({ group }, 201);
});

// Get group details + members
router.get('/:id', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const groupId = c.req.param('id');
  if (!(await assertMember(groupId, userId))) return c.json({ error: 'Forbidden' }, 403);

  const [{ data: group, error: ge }, { data: members }] = await Promise.all([
    supabase.from('groups').select('id, name, created_by, created_at').eq('id', groupId).single(),
    supabase.from('group_members').select('id, group_id, user_id, joined_at, users(id, email, display_name)').eq('group_id', groupId),
  ]);

  if (ge) return c.json({ error: 'Group not found' }, 404);

  const formattedMembers = (members ?? []).map((m) => ({
    id: m.id,
    group_id: m.group_id,
    user_id: m.user_id,
    joined_at: m.joined_at,
    user: m.users as unknown as { id: string; email: string; display_name: string | null },
  }));

  return c.json({ group, members: formattedMembers });
});

// Rename a group (any member can rename)
router.patch('/:id', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const groupId = c.req.param('id');
  if (!(await assertMember(groupId, userId))) return c.json({ error: 'Forbidden' }, 403);

  const { name } = await c.req.json<{ name: string }>();
  if (!name?.trim()) return c.json({ error: 'name is required' }, 400);

  const { data: group, error } = await supabase
    .from('groups')
    .update({ name: name.trim() })
    .eq('id', groupId)
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ group });
});

// Add a member to a group (any existing member can do this)
router.post('/:id/members', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const groupId = c.req.param('id');
  if (!(await assertMember(groupId, userId))) return c.json({ error: 'Forbidden' }, 403);

  const { user_id } = await c.req.json<{ user_id: string }>();
  if (!user_id) return c.json({ error: 'user_id is required' }, 400);

  const { error } = await supabase
    .from('group_members')
    .upsert({ group_id: groupId, user_id }, { onConflict: 'group_id,user_id' });

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true }, 201);
});

// Remove a member (self or creator)
router.delete('/:id/members/:userId', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const groupId = c.req.param('id');
  const targetUserId = c.req.param('userId');

  // Only allow if removing self, or if caller is the group creator
  const { data: group } = await supabase.from('groups').select('created_by').eq('id', groupId).single();
  if (!group) return c.json({ error: 'Group not found' }, 404);
  if (targetUserId !== userId && group.created_by !== userId) return c.json({ error: 'Forbidden' }, 403);

  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', targetUserId);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// List receipts in a group
router.get('/:id/receipts', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const groupId = c.req.param('id');
  if (!(await assertMember(groupId, userId))) return c.json({ error: 'Forbidden' }, 403);

  const { data: receipts, error } = await supabase
    .from('receipts')
    .select('id, owner_id, restaurant_name, date, subtotal, tax, tip, total, group_id, created_at, owner:users!owner_id(display_name, email)')
    .eq('group_id', groupId)
    .order('date', { ascending: false });

  if (error) return c.json({ error: error.message }, 500);
  const mapped = (receipts ?? []).map((r: any) => {
    const { owner, ...rest } = r;
    return { ...rest, owner_name: owner?.display_name ?? owner?.email ?? null };
  });
  return c.json({ receipts: mapped });
});

// Balances scoped to a group (same structure as /api/splits/balances)
router.get('/:id/balances', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const groupId = c.req.param('id');
  if (!(await assertMember(groupId, userId))) return c.json({ error: 'Forbidden' }, 403);

  const { data: receipts } = await supabase
    .from('receipts')
    .select('id')
    .eq('group_id', groupId);

  const receiptIds = (receipts ?? []).map((r) => r.id);
  const maps = await computeBalancesForReceipts(userId, receiptIds);
  const balances = await buildBalanceSummaries(userId, maps);

  return c.json({ balances });
});

// Breakdown for a specific peer scoped to a group
router.get('/:id/breakdown/:peerId', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const groupId = c.req.param('id');
  const peerId = c.req.param('peerId');

  if (!(await assertMember(groupId, userId))) return c.json({ error: 'Forbidden' }, 403);

  const { data: receipts } = await supabase
    .from('receipts')
    .select('id')
    .eq('group_id', groupId);

  const receiptIds = (receipts ?? []).map((r) => r.id);

  type BreakdownRow = { receipt_id: string; restaurant_name: string | null; date: string; amount: number };

  const shares = await loadReceiptShares(receiptIds);

  // Amounts the assignee owes the owner, one row per receipt
  function calcSide(ownerId: string, assigneeId: string): BreakdownRow[] {
    const rows: BreakdownRow[] = [];
    for (const r of shares.values()) {
      const amount = r.totals.get(assigneeId);
      if (r.owner_id !== ownerId || !amount) continue;
      rows.push({ receipt_id: r.id, restaurant_name: r.restaurant_name, date: r.date, amount });
    }
    return rows;
  }

  let theyOweMe = calcSide(userId, peerId);
  let iOweThem = calcSide(peerId, userId);

  const allReceiptIds = [...theyOweMe.map((r) => r.receipt_id), ...iOweThem.map((r) => r.receipt_id)];

  if (allReceiptIds.length) {
    const { data: settlements } = await supabase
      .from('settlements')
      .select('receipt_id, from_user_id, to_user_id, amount')
      .in('receipt_id', allReceiptIds)
      .not('paid_at', 'is', null);

    const theyPaid = new Map<string, number>();
    const iPaid = new Map<string, number>();

    for (const s of settlements ?? []) {
      if (s.from_user_id === peerId && s.to_user_id === userId) theyPaid.set(s.receipt_id, (theyPaid.get(s.receipt_id) ?? 0) + s.amount);
      if (s.from_user_id === userId && s.to_user_id === peerId) iPaid.set(s.receipt_id, (iPaid.get(s.receipt_id) ?? 0) + s.amount);
    }

    theyOweMe = theyOweMe.map((r) => ({ ...r, amount: Number((r.amount - (theyPaid.get(r.receipt_id) ?? 0)).toFixed(2)) })).filter((r) => r.amount > 0.005);
    iOweThem = iOweThem.map((r) => ({ ...r, amount: Number((r.amount - (iPaid.get(r.receipt_id) ?? 0)).toFixed(2)) })).filter((r) => r.amount > 0.005);
  }

  return c.json({
    they_owe_me: theyOweMe.sort((a, b) => b.date.localeCompare(a.date)),
    i_owe_them: iOweThem.sort((a, b) => b.date.localeCompare(a.date)),
  });
});

// Sum of the current user's actual assignment amounts across all group receipts.
// This is settlement-independent — it reflects the user's true share of expenses.
router.get('/:id/my-spend', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const groupId = c.req.param('id');
  if (!(await assertMember(groupId, userId))) return c.json({ error: 'Forbidden' }, 403);

  const { data: receipts } = await supabase
    .from('receipts')
    .select('id')
    .eq('group_id', groupId);

  const shares = await loadReceiptShares((receipts ?? []).map((r) => r.id));

  let total = 0;
  for (const r of shares.values()) total += r.totals.get(userId) ?? 0;

  return c.json({ my_spend: Number(total.toFixed(2)) });
});

// List pairs for a group
router.get('/:id/pairs', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const groupId = c.req.param('id');
  if (!(await assertMember(groupId, userId))) return c.json({ error: 'Forbidden' }, 403);

  const { data: pairs, error } = await supabase
    .from('group_pairs')
    .select('id, group_id, user_id_1, user_id_2')
    .eq('group_id', groupId);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ pairs: pairs ?? [] });
});

// Create a pair within a group
router.post('/:id/pairs', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const groupId = c.req.param('id');
  if (!(await assertMember(groupId, userId))) return c.json({ error: 'Forbidden' }, 403);

  const { user_id_1, user_id_2 } = await c.req.json<{ user_id_1: string; user_id_2: string }>();
  if (!user_id_1 || !user_id_2) return c.json({ error: 'user_id_1 and user_id_2 are required' }, 400);
  if (user_id_1 === user_id_2) return c.json({ error: 'Cannot pair a member with themselves' }, 400);

  const { data: pair, error } = await supabase
    .from('group_pairs')
    .upsert({ group_id: groupId, user_id_1, user_id_2 }, { onConflict: 'group_id,user_id_1,user_id_2' })
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ pair }, 201);
});

// Delete a pair
router.delete('/:id/pairs/:pairId', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const groupId = c.req.param('id');
  if (!(await assertMember(groupId, userId))) return c.json({ error: 'Forbidden' }, 403);

  const pairId = c.req.param('pairId');
  const { error } = await supabase
    .from('group_pairs')
    .delete()
    .eq('id', pairId)
    .eq('group_id', groupId);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

export default router;
