import { Hono } from 'hono';
import type { SplitCalculation, BalanceSummary, Settlement } from '@split-it/types';
import { requireAuth } from '../lib/auth.js';
import { supabase } from '../lib/supabase.js';

const router = new Hono();

// Calculate per-person totals for a receipt (tax + tip applied proportionally)
router.get('/calculate/:receiptId', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const receiptId = c.req.param('receiptId');

  const { data: receipt, error: re } = await supabase
    .from('receipts')
    .select('id, subtotal, tax, tip, total')
    .eq('id', receiptId)
    .single();

  if (re) return c.json({ error: 'Receipt not found' }, 404);

  const { data: lineItems, error: lie } = await supabase
    .from('line_items')
    .select('id, total_price')
    .eq('receipt_id', receiptId);

  if (lie) return c.json({ error: lie.message }, 500);

  const lineItemIds = (lineItems ?? []).map((li) => li.id);
  if (!lineItemIds.length) return c.json({ splits: [] });

  const { data: assignments, error: ae } = await supabase
    .from('assignments')
    .select('user_id, line_item_id, fraction, computed_amount')
    .in('line_item_id', lineItemIds);

  if (ae) return c.json({ error: ae.message }, 500);

  // Sum each person's computed_amount (their item share)
  const subtotalByUser = new Map<string, number>();
  for (const a of assignments ?? []) {
    subtotalByUser.set(a.user_id, (subtotalByUser.get(a.user_id) ?? 0) + a.computed_amount);
  }

  const receiptSubtotal = receipt.subtotal ?? [...subtotalByUser.values()].reduce((s, v) => s + v, 0);
  const tax = receipt.tax ?? 0;
  const tip = receipt.tip ?? 0;
  const overhead = tax + tip;

  const splits: SplitCalculation[] = [];
  for (const [uid, rawItemShare] of subtotalByUser) {
    const itemShare = Number(rawItemShare.toFixed(2));
    const proportion = receiptSubtotal > 0 ? rawItemShare / receiptSubtotal : 0;
    const taxShare = Number((proportion * overhead).toFixed(2));
    splits.push({ user_id: uid, items_total: itemShare, tax_tip_share: taxShare, grand_total: Number((itemShare + taxShare).toFixed(2)) });
  }

  return c.json({ splits });
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
    supabase.from('receipts').select('id, subtotal, tax, tip').eq('owner_id', userId),
    supabase.from('assignments').select('computed_amount, line_items(receipt_id)').eq('user_id', userId),
    supabase.from('settlements').select('to_user_id, amount').eq('from_user_id', userId).not('paid_at', 'is', null),
    supabase.from('settlements').select('from_user_id, amount').eq('to_user_id', userId).not('paid_at', 'is', null),
  ]);

  const ownedIds = (ownedReceipts ?? []).map((r) => r.id);
  const receiptAssignedIds = [
    ...new Set(
      (myAssignments ?? [])
        .map((a) => (a.line_items as unknown as { receipt_id: string } | null)?.receipt_id)
        .filter(Boolean) as string[]
    ),
  ].filter((id) => !ownedIds.includes(id));

  // Layer 2: fetch line items for owned receipts + details for other receipts in parallel
  const [{ data: lis }, { data: otherReceipts }] = await Promise.all([
    ownedIds.length
      ? supabase.from('line_items').select('id, receipt_id, total_price').in('receipt_id', ownedIds)
      : Promise.resolve({ data: [] as { id: string; receipt_id: string; total_price: number }[] }),
    receiptAssignedIds.length
      ? supabase.from('receipts').select('id, owner_id, subtotal, tax, tip').in('id', receiptAssignedIds)
      : Promise.resolve({ data: [] as { id: string; owner_id: string; subtotal: number | null; tax: number | null; tip: number | null }[] }),
  ]);

  const lineItemMap = new Map<string, { receipt_id: string; total_price: number }>();
  for (const li of lis ?? []) lineItemMap.set(li.id, { receipt_id: li.receipt_id, total_price: li.total_price });

  // Layer 3: assignments on owned line items (depends on layer 2)
  const { data: asgn } = lineItemMap.size
    ? await supabase.from('assignments').select('user_id, line_item_id, computed_amount').in('line_item_id', [...lineItemMap.keys()]).neq('user_id', userId)
    : { data: [] as { user_id: string; line_item_id: string; computed_amount: number }[] };

  // Compute owedToMe from owned receipts
  const owedToMe = new Map<string, number>();
  const itemsByUserReceipt = new Map<string, Map<string, number>>();
  for (const a of asgn ?? []) {
    const li = lineItemMap.get(a.line_item_id);
    if (!li) continue;
    if (!itemsByUserReceipt.has(a.user_id)) itemsByUserReceipt.set(a.user_id, new Map());
    const byReceipt = itemsByUserReceipt.get(a.user_id)!;
    byReceipt.set(li.receipt_id, (byReceipt.get(li.receipt_id) ?? 0) + a.computed_amount);
  }
  for (const [uid, byReceipt] of itemsByUserReceipt) {
    let total = 0;
    for (const [rid, itemAmt] of byReceipt) {
      const receipt = (ownedReceipts ?? []).find((r) => r.id === rid);
      if (!receipt) continue;
      const subtotal = receipt.subtotal ?? 0;
      const overhead = (receipt.tax ?? 0) + (receipt.tip ?? 0);
      const taxShare = subtotal > 0 ? Number(((itemAmt / subtotal) * overhead).toFixed(2)) : 0;
      total += Number((itemAmt + taxShare).toFixed(2));
    }
    owedToMe.set(uid, total);
  }

  // Compute iOwe from receipts the user is assigned to but doesn't own
  const iOwe = new Map<string, number>();
  const itemsByReceipt = new Map<string, number>();
  for (const a of myAssignments ?? []) {
    const receiptId = (a.line_items as unknown as { receipt_id: string } | null)?.receipt_id;
    if (!receiptId || ownedIds.includes(receiptId)) continue;
    itemsByReceipt.set(receiptId, (itemsByReceipt.get(receiptId) ?? 0) + a.computed_amount);
  }
  for (const [rid, itemAmt] of itemsByReceipt) {
    const receipt = (otherReceipts ?? []).find((r) => r.id === rid);
    if (!receipt) continue;
    const subtotal = receipt.subtotal ?? 0;
    const overhead = (receipt.tax ?? 0) + (receipt.tip ?? 0);
    const taxShare = subtotal > 0 ? Number(((itemAmt / subtotal) * overhead).toFixed(2)) : 0;
    iOwe.set(receipt.owner_id, (iOwe.get(receipt.owner_id) ?? 0) + Number((itemAmt + taxShare).toFixed(2)));
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

  async function calcSide(ownerIdFilter: string, assigneeIdFilter: string): Promise<BreakdownRow[]> {
    const { data: receipts } = await supabase
      .from('receipts')
      .select('id, restaurant_name, date, subtotal, tax, tip')
      .eq('owner_id', ownerIdFilter);

    const ids = (receipts ?? []).map((r) => r.id);
    if (!ids.length) return [];

    const { data: lis } = await supabase
      .from('line_items')
      .select('id, receipt_id, total_price')
      .in('receipt_id', ids);

    const liMap = new Map<string, { receipt_id: string; total_price: number }>();
    for (const li of lis ?? []) liMap.set(li.id, { receipt_id: li.receipt_id, total_price: li.total_price });
    if (!liMap.size) return [];

    const { data: asgn } = await supabase
      .from('assignments')
      .select('line_item_id, computed_amount')
      .in('line_item_id', [...liMap.keys()])
      .eq('user_id', assigneeIdFilter);

    const amtByReceipt = new Map<string, number>();
    for (const a of asgn ?? []) {
      const li = liMap.get(a.line_item_id);
      if (li) amtByReceipt.set(li.receipt_id, (amtByReceipt.get(li.receipt_id) ?? 0) + a.computed_amount);
    }

    const rows: BreakdownRow[] = [];
    for (const [rid, itemAmt] of amtByReceipt) {
      const r = (receipts ?? []).find((x) => x.id === rid);
      if (!r) continue;
      const subtotal = r.subtotal ?? 0;
      const overhead = (r.tax ?? 0) + (r.tip ?? 0);
      const taxShare = subtotal > 0 ? Number(((itemAmt / subtotal) * overhead).toFixed(2)) : 0;
      rows.push({ receipt_id: rid, restaurant_name: r.restaurant_name, date: r.date, amount: Number((itemAmt + taxShare).toFixed(2)) });
    }
    return rows;
  }

  // Run both sides concurrently — they're fully independent
  let [theyOweMe, iOweThem] = await Promise.all([
    calcSide(userId, peerId),
    calcSide(peerId, userId),
  ]);

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
