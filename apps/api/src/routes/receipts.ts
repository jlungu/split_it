import { Hono } from 'hono';
import type { Receipt, LineItem, Assignment, ReceiptWithDetails } from '@split-it/types';
import { requireAuth } from '../lib/auth.js';
import { supabase } from '../lib/supabase.js';

const router = new Hono();

// List receipts where the user is owner or assignee
router.get('/', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  // Receipts owned by the user
  const { data: owned, error: e1 } = await supabase
    .from('receipts')
    .select('id, owner_id, restaurant_name, date, subtotal, tax, tip, total, created_at')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false });

  // Receipts where the user appears in assignments
  const { data: assignedRows, error: e2 } = await supabase
    .from('assignments')
    .select('line_items(receipt_id)')
    .eq('user_id', userId);

  if (e1 || e2) return c.json({ error: e1?.message ?? e2?.message }, 500);

  const assignedIds = [
    ...new Set(
      (assignedRows ?? [])
        .map((a) => (a.line_items as unknown as { receipt_id: string } | null)?.receipt_id)
        .filter(Boolean) as string[]
    ),
  ];

  let assigned: Receipt[] = [];
  if (assignedIds.length > 0) {
    const { data, error } = await supabase
      .from('receipts')
      .select('id, owner_id, restaurant_name, date, subtotal, tax, tip, total, created_at')
      .in('id', assignedIds)
      .neq('owner_id', userId)
      .order('created_at', { ascending: false });
    if (error) return c.json({ error: error.message }, 500);
    assigned = (data as Receipt[]) ?? [];
  }

  const all = [...((owned as Receipt[]) ?? []), ...assigned].sort(
    (a, b) => new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime()
  );

  return c.json({ receipts: all });
});

// Create a new receipt with line items and assignments
router.post('/', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{
    restaurant_name?: string;
    date?: string;
    subtotal?: number;
    tax?: number;
    tip?: number;
    total?: number;
    line_items: Array<{
      description: string;
      unit_price: number;
      quantity: number;
      total_price: number;
      position: number;
      assignments: Array<{ user_id: string; fraction: number }>;
    }>;
  }>();

  // Insert receipt
  const { data: receipt, error: re } = await supabase
    .from('receipts')
    .insert({
      owner_id: userId,
      restaurant_name: body.restaurant_name ?? null,
      date: body.date ?? new Date().toISOString().slice(0, 10),
      subtotal: body.subtotal ?? null,
      tax: body.tax ?? null,
      tip: body.tip ?? null,
      total: body.total ?? null,
      group_id: (body as { group_id?: string | null }).group_id ?? null,
    })
    .select()
    .single();

  if (re) return c.json({ error: re.message }, 500);

  // Insert line items
  for (const item of body.line_items ?? []) {
    const { data: li, error: lie } = await supabase
      .from('line_items')
      .insert({
        receipt_id: receipt.id,
        description: item.description,
        unit_price: item.unit_price,
        quantity: item.quantity,
        total_price: item.total_price,
        position: item.position,
      })
      .select()
      .single();

    if (lie) return c.json({ error: lie.message }, 500);

    // Insert assignments for this line item
    if (item.assignments?.length) {
      const rows = item.assignments.map((a) => ({
        line_item_id: li.id,
        user_id: a.user_id,
        fraction: a.fraction,
        computed_amount: Number((a.fraction * item.total_price).toFixed(2)),
      }));
      const { error: ae } = await supabase.from('assignments').insert(rows);
      if (ae) return c.json({ error: ae.message }, 500);
    }
  }

  return c.json({ receipt: receipt as Receipt }, 201);
});

// Get a single receipt with all line items and assignments
router.get('/:id', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const receiptId = c.req.param('id');

  const { data: receipt, error: re } = await supabase
    .from('receipts')
    .select('id, owner_id, restaurant_name, date, subtotal, tax, tip, total, group_id, created_at')
    .eq('id', receiptId)
    .single();

  if (re) return c.json({ error: 'Receipt not found' }, 404);

  const { data: lineItems, error: lie } = await supabase
    .from('line_items')
    .select('id, receipt_id, description, unit_price, quantity, total_price, position')
    .eq('receipt_id', receiptId)
    .order('position');

  if (lie) return c.json({ error: lie.message }, 500);

  const lineItemIds = (lineItems ?? []).map((li) => li.id);
  let assignments: Assignment[] = [];
  if (lineItemIds.length > 0) {
    const { data: asgn, error: ae } = await supabase
      .from('assignments')
      .select('id, line_item_id, user_id, fraction, computed_amount, user:users(id, email, display_name, venmo_handle, zelle_contact)')
      .in('line_item_id', lineItemIds);
    if (ae) return c.json({ error: ae.message }, 500);
    assignments = (asgn as unknown as Assignment[]) ?? [];
  }

  const itemsWithAssignments = (lineItems ?? []).map((li) => ({
    ...(li as LineItem),
    assignments: assignments.filter((a) => a.line_item_id === li.id),
  }));

  const { data: ownerUser } = await supabase
    .from('users')
    .select('id, email, display_name, venmo_handle, zelle_contact')
    .eq('id', receipt.owner_id)
    .single();

  const result: ReceiptWithDetails = {
    ...(receipt as Receipt),
    line_items: itemsWithAssignments,
    owner: ownerUser,
  };

  return c.json({ receipt: result });
});

// Update receipt metadata (restaurant name, date, tax, tip, total)
router.put('/:id', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const receiptId = c.req.param('id');
  const body = await c.req.json<Partial<Receipt>>();

  const { data, error } = await supabase
    .from('receipts')
    .update({
      restaurant_name: body.restaurant_name,
      date: body.date,
      subtotal: body.subtotal,
      tax: body.tax,
      tip: body.tip,
      total: body.total,
      group_id: body.group_id,
    })
    .eq('id', receiptId)
    .eq('owner_id', userId)
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ receipt: data as Receipt });
});

// Delete a receipt (owner only)
router.delete('/:id', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const receiptId = c.req.param('id');

  const { error } = await supabase
    .from('receipts')
    .delete()
    .eq('id', receiptId)
    .eq('owner_id', userId);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

export default router;
