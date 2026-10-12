import type { SplitCalculation } from '@split-it/types';
import { supabase } from './supabase.js';

// All split math is done in integer cents and distributed with the largest-remainder
// method, so per-person amounts always add back up to the exact item price and
// tax + tip — rounding each share independently drifts by cents on larger bills.

type ShareLineItem = { id: string; total_price: number };
type ShareAssignment = { line_item_id: string; user_id: string; fraction: number };

const toCents = (n: number | null | undefined) => Math.round((n ?? 0) * 100);

// Split totalCents across keys in proportion to weights; results sum to totalCents exactly.
function allocate(totalCents: number, weights: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const sum = [...weights.values()].reduce((s, w) => s + w, 0);
  if (sum <= 0 || totalCents === 0) return out;

  const parts = [...weights].map(([key, w]) => {
    const exact = (totalCents * w) / sum;
    const floor = Math.floor(exact);
    return { key, floor, rem: exact - floor };
  });
  let leftover = totalCents - parts.reduce((s, p) => s + p.floor, 0);
  // Hand leftover cents to the largest remainders; tie-break on key so results are stable
  parts.sort((a, b) => b.rem - a.rem || a.key.localeCompare(b.key));
  for (const p of parts) {
    out.set(p.key, p.floor + (leftover > 0 ? 1 : 0));
    if (leftover > 0) leftover--;
  }
  return out;
}

// Per-person totals for one receipt. Tax + tip is spread in proportion to item shares,
// measured against the sum of line items (not the stored subtotal, which comes from OCR
// and can disagree with the items). Tax/tip on unassigned items stays with the owner.
export function computeShares(
  receipt: { tax: number | null; tip: number | null },
  lineItems: ShareLineItem[],
  assignments: ShareAssignment[],
): SplitCalculation[] {
  const byItem = new Map<string, ShareAssignment[]>();
  for (const a of assignments) {
    if (!byItem.has(a.line_item_id)) byItem.set(a.line_item_id, []);
    byItem.get(a.line_item_id)!.push(a);
  }

  const itemCents = new Map<string, number>();
  let lineSumCents = 0;
  for (const li of lineItems) {
    const priceCents = toCents(li.total_price);
    lineSumCents += priceCents;
    const asgn = byItem.get(li.id) ?? [];
    if (!asgn.length) continue;

    // Fractions are stored to 4dp (1/3 → 0.3333); treat near-1 sums as a full split
    const fractionSum = asgn.reduce((s, a) => s + Number(a.fraction), 0);
    const assignedCents = Math.abs(fractionSum - 1) < 0.001
      ? priceCents
      : Math.round(priceCents * Math.min(1, fractionSum));

    const weights = new Map<string, number>();
    for (const a of asgn) weights.set(a.user_id, (weights.get(a.user_id) ?? 0) + Number(a.fraction));
    for (const [uid, cents] of allocate(assignedCents, weights)) {
      itemCents.set(uid, (itemCents.get(uid) ?? 0) + cents);
    }
  }

  const assignedSumCents = [...itemCents.values()].reduce((s, v) => s + v, 0);
  const overheadCents = toCents(receipt.tax) + toCents(receipt.tip);
  const assignedOverheadCents = lineSumCents > 0
    ? Math.round((overheadCents * assignedSumCents) / lineSumCents)
    : 0;
  const overheadByUser = allocate(assignedOverheadCents, itemCents);

  return [...itemCents].map(([uid, items]) => {
    const overhead = overheadByUser.get(uid) ?? 0;
    return {
      user_id: uid,
      items_total: items / 100,
      tax_tip_share: overhead / 100,
      grand_total: (items + overhead) / 100,
    };
  });
}

export type ReceiptShares = {
  id: string;
  owner_id: string;
  restaurant_name: string | null;
  date: string;
  splits: SplitCalculation[];
  // grand_total per user_id
  totals: Map<string, number>;
};

// Load receipts with their line items and assignments, and compute every person's share.
export async function loadReceiptShares(receiptIds: string[]): Promise<Map<string, ReceiptShares>> {
  const result = new Map<string, ReceiptShares>();
  const ids = [...new Set(receiptIds)];
  if (!ids.length) return result;

  const [{ data: receipts }, { data: lineItems }] = await Promise.all([
    supabase.from('receipts').select('id, owner_id, restaurant_name, date, tax, tip').in('id', ids),
    supabase.from('line_items').select('id, receipt_id, total_price').in('receipt_id', ids),
  ]);

  const liIds = (lineItems ?? []).map((li) => li.id);
  const { data: assignments } = liIds.length
    ? await supabase.from('assignments').select('line_item_id, user_id, fraction').in('line_item_id', liIds)
    : { data: [] as ShareAssignment[] };

  const lisByReceipt = new Map<string, ShareLineItem[]>();
  const receiptOfLi = new Map<string, string>();
  for (const li of lineItems ?? []) {
    receiptOfLi.set(li.id, li.receipt_id);
    if (!lisByReceipt.has(li.receipt_id)) lisByReceipt.set(li.receipt_id, []);
    lisByReceipt.get(li.receipt_id)!.push(li);
  }
  const asgnByReceipt = new Map<string, ShareAssignment[]>();
  for (const a of assignments ?? []) {
    const rid = receiptOfLi.get(a.line_item_id);
    if (!rid) continue;
    if (!asgnByReceipt.has(rid)) asgnByReceipt.set(rid, []);
    asgnByReceipt.get(rid)!.push(a);
  }

  for (const r of receipts ?? []) {
    const splits = computeShares(r, lisByReceipt.get(r.id) ?? [], asgnByReceipt.get(r.id) ?? []);
    result.set(r.id, {
      id: r.id,
      owner_id: r.owner_id,
      restaurant_name: r.restaurant_name,
      date: r.date,
      splits,
      totals: new Map(splits.map((s) => [s.user_id, s.grand_total])),
    });
  }
  return result;
}
