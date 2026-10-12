import { Hono } from 'hono';
import type { BalanceSummary, Settlement } from '@split-it/types';
import { requireAuth } from '../lib/auth.js';
import { loadReceiptShares } from '../lib/split.js';
import { supabase } from '../lib/supabase.js';

const router = new Hono();

// Calculate per-person totals for a receipt (tax + tip applied proportionally)
router.get('/calculate/:receiptId', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const receiptId = c.req.param('receiptId');

  const shares = (await loadReceiptShares([receiptId])).get(receiptId);
  if (!shares) return c.json({ error: 'Receipt not found' }, 404);

  return c.json({ splits: shares.splits });
});

// Record a settlement payment between two users on a receipt
router.post('/settle', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const { receipt_id, to_user_id, from_user_id, amount, payment_method } = await c.req.json<{
    receipt_id: string;
    to_user_id: string;
    from_user_id?: string;
    amount: number;
    payment_method: 'venmo' | 'zelle' | 'cash' | 'other';
  }>();

  const { data, error } = await supabase
    .from('settlements')
    .insert({
      receipt_id,
      from_user_id: from_user_id ?? userId,
      to_user_id,
      amount,
      payment_method,
      paid_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ settlement: data as Settlement }, 201);
});

// Aggregate balances: how much the current user owes or is owed per person
router.get('/balances', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  // Layer 1: fire all independent queries in parallel
  const [
    { data: ownedReceipts },
    { data: myAssignments },
    { data: settlementsFrom },
    { data: settlementsTo },
  ] = await Promise.all([
    supabase.from('receipts').select('id').eq('owner_id', userId),
    supabase.from('assignments').select('line_items(receipt_id)').eq('user_id', userId),
    supabase.from('settlements').select('to_user_id, amount').eq('from_user_id', userId).not('paid_at', 'is', null),
    supabase.from('settlements').select('from_user_id, amount').eq('to_user_id', userId).not('paid_at', 'is', null),
  ]);

  const assignedReceiptIds = (myAssignments ?? [])
    .map((a) => (a.line_items as unknown as { receipt_id: string } | null)?.receipt_id)
    .filter(Boolean) as string[];

  // Layer 2: every person's share on each receipt I own or am assigned to
  const shares = await loadReceiptShares([...(ownedReceipts ?? []).map((r) => r.id), ...assignedReceiptIds]);

  const owedToMe = new Map<string, number>();
  const iOwe = new Map<string, number>();
  for (const r of shares.values()) {
    if (r.owner_id === userId) {
      for (const [uid, amt] of r.totals) {
        if (uid !== userId) owedToMe.set(uid, (owedToMe.get(uid) ?? 0) + amt);
      }
    } else {
      const amt = r.totals.get(userId);
      if (amt) iOwe.set(r.owner_id, (iOwe.get(r.owner_id) ?? 0) + amt);
    }
  }

  // Apply settlements
  for (const s of settlementsFrom ?? []) {
    iOwe.set(s.to_user_id, Math.max(0, (iOwe.get(s.to_user_id) ?? 0) - s.amount));
  }
  for (const s of settlementsTo ?? []) {
    owedToMe.set(s.from_user_id, Math.max(0, (owedToMe.get(s.from_user_id) ?? 0) - s.amount));
  }

  const peerIds = [...new Set([...owedToMe.keys(), ...iOwe.keys()])];

  let users: { id: string; email: string; display_name: string | null; venmo_handle: string | null; zelle_contact: string | null }[] = [];
  if (peerIds.length) {
    const { data } = await supabase.from('users').select('id, email, display_name, venmo_handle, zelle_contact').in('id', peerIds);
    users = data ?? [];
  }

  const balances: BalanceSummary[] = peerIds.map((pid) => {
    const peer = users.find((u) => u.id === pid);
    const theyOweMe = owedToMe.get(pid) ?? 0;
    const iOweThem = iOwe.get(pid) ?? 0;
    const net = Number((theyOweMe - iOweThem).toFixed(2));
    return {
      peer_user_id: pid,
      peer_email: peer?.email ?? '',
      peer_display_name: peer?.display_name ?? null,
      peer_venmo_handle: peer?.venmo_handle ?? null,
      peer_zelle_contact: peer?.zelle_contact ?? null,
      net_amount: net,
      you_owe: iOweThem > theyOweMe ? Number((iOweThem - theyOweMe).toFixed(2)) : 0,
      they_owe: theyOweMe > iOweThem ? Number((theyOweMe - iOweThem).toFixed(2)) : 0,
    };
  }).filter((b) => b.net_amount !== 0 || b.you_owe !== 0 || b.they_owe !== 0);

  return c.json({ balances });
});

// Breakdown of which receipts make up the balance with a specific peer
router.get('/breakdown/:peerId', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const peerId = c.req.param('peerId');

  type BreakdownRow = { receipt_id: string; restaurant_name: string | null; date: string; amount: number };

  const { data: receipts } = await supabase
    .from('receipts')
    .select('id')
    .in('owner_id', [userId, peerId]);
  const shares = await loadReceiptShares((receipts ?? []).map((r) => r.id));

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

  // Subtract any settlements between these two users on these receipts
  const allReceiptIds = [
    ...theyOweMe.map((r) => r.receipt_id),
    ...iOweThem.map((r) => r.receipt_id),
  ];

  if (allReceiptIds.length) {
    const { data: settlements } = await supabase
      .from('settlements')
      .select('receipt_id, from_user_id, to_user_id, amount')
      .in('receipt_id', allReceiptIds)
      .not('paid_at', 'is', null);

    const theyPaid = new Map<string, number>();
    const iPaid = new Map<string, number>();

    for (const s of settlements ?? []) {
      if (s.from_user_id === peerId && s.to_user_id === userId) {
        theyPaid.set(s.receipt_id, (theyPaid.get(s.receipt_id) ?? 0) + s.amount);
      }
      if (s.from_user_id === userId && s.to_user_id === peerId) {
        iPaid.set(s.receipt_id, (iPaid.get(s.receipt_id) ?? 0) + s.amount);
      }
    }

    theyOweMe = theyOweMe
      .map((r) => ({ ...r, amount: Number((r.amount - (theyPaid.get(r.receipt_id) ?? 0)).toFixed(2)) }))
      .filter((r) => r.amount > 0.005);

    iOweThem = iOweThem
      .map((r) => ({ ...r, amount: Number((r.amount - (iPaid.get(r.receipt_id) ?? 0)).toFixed(2)) }))
      .filter((r) => r.amount > 0.005);
  }

  return c.json({
    they_owe_me: theyOweMe.sort((a, b) => b.date.localeCompare(a.date)),
    i_owe_them: iOweThem.sort((a, b) => b.date.localeCompare(a.date)),
  });
});

export default router;
