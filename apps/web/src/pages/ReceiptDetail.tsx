import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { calculateSplit, getReceipt, settle, getMe, deleteReceipt, listGroups, assignReceiptToGroup, getGroupPairs } from '../lib/api';
import type { GroupSummary, ReceiptWithDetails, SplitCalculation, User } from '@split-it/types';

function formatMoney(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

function venmoUrl(handle: string, amount: number, note: string) {
  return `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(handle)}&amount=${amount.toFixed(2)}&note=${encodeURIComponent(note)}`;
}

function venmoRequestUrl(handle: string, amount: number, note: string) {
  return `venmo://paycharge?txn=charge&recipients=${encodeURIComponent(handle)}&amount=${amount.toFixed(2)}&note=${encodeURIComponent(note)}`;
}

type SplitGroup = { ids: string[] };

function imgName(userId: string, me: User | null, peerUsers: Map<string, User>): string {
  if (userId === me?.id) return (me?.display_name ?? me?.email?.split('@')[0] ?? 'ME').toUpperCase();
  const peer = peerUsers.get(userId);
  return (peer?.display_name ?? peer?.email?.split('@')[0] ?? '?').toUpperCase();
}

function generateSplitImage(
  restaurantName: string,
  date: string,
  splits: SplitCalculation[],
  peerUsers: Map<string, User>,
  me: User | null,
  groups: SplitGroup[],
  receiptTotal: number | null,
): { blob: Blob; dataUrl: string } {
  const SCALE = 2;
  const W = 260;
  const PAD = 16;
  const MONO = 'monospace';
  const HEADER_H = 64;
  // DIVPAD values chosen so visual gap on both sides of every divider ≈ 14px:
  //   above: advance - descender ≈ 14  (SUBTOTAL_LS 16 - 2 = 14; NAME_LS 18 - 3 = 15)
  //   below: DIVPAD - cap_height  = 14 (23 - 9 = 14 for 12px;  20 - 6 = 14 for 9px)
  const DIVPAD = 23;
  const DIVPAD_SM = 20;
  const NAME_LS = 18;
  const BREAK_LS = 13;
  const PERSON_GAP = 6;
  const SUBTOTAL_LS = 16;
  const GROUP_SEP_H = 18; // space after a group subtotal (includes thin separator line)

  // Build a flat draw list respecting groups
  type DrawRow =
    | { kind: 'person'; name: string; amount: number }
    | { kind: 'subtotal'; label: string; amount: number };

  const drawRows: DrawRow[] = [];
  const emittedGroups = new Set<number>();
  for (const split of splits) {
    const gIdx = groups.findIndex(g => g.ids.includes(split.user_id));
    if (gIdx === -1) {
      const n = imgName(split.user_id, me, peerUsers);
      drawRows.push({ kind: 'person', name: n, amount: split.grand_total });
    } else if (!emittedGroups.has(gIdx)) {
      emittedGroups.add(gIdx);
      const members = groups[gIdx].ids.map(id => splits.find(s => s.user_id === id)!).filter(Boolean);
      for (const m of members) {
        const n = imgName(m.user_id, me, peerUsers);
        drawRows.push({ kind: 'person', name: n, amount: m.grand_total });
      }
      drawRows.push({
        kind: 'subtotal',
        label: groups[gIdx].ids.map(id => imgName(id, me, peerUsers)).join(' & '),
        amount: members.reduce((s, m) => s + m.grand_total, 0),
      });
    }
  }

  const rowsH = drawRows.reduce((sum, r, i) => {
    const rowH = r.kind === 'person' ? NAME_LS : SUBTOTAL_LS;
    const isLast = i === drawRows.length - 1;
    const gap = isLast ? 0 : (r.kind === 'subtotal' ? GROUP_SEP_H : PERSON_GAP);
    return sum + rowH + gap;
  }, 0);

  const H = HEADER_H + 2 * DIVPAD + DIVPAD_SM + rowsH + NAME_LS + 10;

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = '#fffef9';
  ctx.fillRect(0, 0, W, H);

  let y = 0;

  function drawDivider() {
    ctx.save();
    ctx.strokeStyle = '#b8b8a8';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
    ctx.restore();
  }

ctx.textAlign = 'center';
  ctx.fillStyle = '#1a1a14';
  ctx.font = `bold 13px ${MONO}`;
  ctx.fillText((restaurantName || 'RECEIPT').toUpperCase(), W / 2, HEADER_H / 2 - 4);
  ctx.fillStyle = '#78786a';
  ctx.font = `10px ${MONO}`;
  ctx.fillText(date, W / 2, HEADER_H / 2 + 12);

  y = HEADER_H;
  drawDivider();
  y += DIVPAD;

  drawRows.forEach((row, i) => {
    if (row.kind === 'person') {
      const name = row.name.length > 13 ? row.name.slice(0, 12) + '…' : row.name;
      ctx.fillStyle = '#1a1a14';
      ctx.font = `12px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.fillText(name, PAD, y);
      ctx.textAlign = 'right';
      ctx.fillText(formatMoney(row.amount), W - PAD, y);
      y += NAME_LS;
    } else {
      const label = row.label.length > 15 ? row.label.slice(0, 14) + '…' : row.label;
      ctx.fillStyle = '#6b7280';
      ctx.font = `600 12px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.fillText(label, PAD, y);
      ctx.textAlign = 'right';
      ctx.fillText(formatMoney(row.amount), W - PAD, y);
      y += SUBTOTAL_LS;
    }
    if (i < drawRows.length - 1) {
      if (row.kind === 'subtotal') {
        y += GROUP_SEP_H;
      } else {
        y += PERSON_GAP;
      }
    }
  });

  drawDivider();
  y += DIVPAD;

  const grandTotal = receiptTotal ?? Number(splits.reduce((sum, s) => sum + s.grand_total, 0).toFixed(2));
  ctx.fillStyle = '#1a1a14';
  ctx.font = `bold 12px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText('TOTAL', PAD, y);
  ctx.textAlign = 'right';
  ctx.fillText(formatMoney(grandTotal), W - PAD, y);
  y += NAME_LS;

  drawDivider();
  y += DIVPAD_SM;

  ctx.fillStyle = '#78786a';
  ctx.font = `9px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText('Split It', W / 2, y);

  const dataUrl = canvas.toDataURL('image/png');
  const byteStr = atob(dataUrl.split(',')[1]);
  const ab = new ArrayBuffer(byteStr.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
  const blob = new Blob([ia], { type: 'image/png' });
  return { blob, dataUrl };
}

export default function ReceiptDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<ReceiptWithDetails | null>(null);
  const [splits, setSplits] = useState<SplitCalculation[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [peerUsers, setPeerUsers] = useState<Map<string, User>>(new Map());
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [settledIds, setSettledIds] = useState<Set<string>>(new Set());
  const [shareDataUrl, setShareDataUrl] = useState<string | null>(null);
  const [availableGroups, setAvailableGroups] = useState<GroupSummary[]>([]);
  const [assigningGroup, setAssigningGroup] = useState(false);
  const [groups, setGroups] = useState<SplitGroup[]>([]);
  const [groupMode, setGroupMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => { window.scrollTo(0, 0); }, []);

  useEffect(() => {
    if (!id) return;
    listGroups().then(({ groups: g }) => setAvailableGroups(g)).catch(() => {});
    Promise.all([getReceipt(id), calculateSplit(id), getMe()]).then(([r, s, m]) => {
      setReceipt(r.receipt);
      setSplits(s.splits);
      setMe(m.user);
      const map = new Map<string, User>();
      for (const li of r.receipt.line_items) {
        for (const a of li.assignments) {
          if (a.user) map.set(a.user.id, a.user as User);
        }
      }
      setPeerUsers(map);
      if (r.receipt.group_id) {
        const assigneeIds = new Set<string>();
        for (const li of r.receipt.line_items) {
          for (const a of li.assignments) assigneeIds.add(a.user_id);
        }
        getGroupPairs(r.receipt.group_id)
          .then(({ pairs }) => {
            const auto: SplitGroup[] = pairs
              .filter((p) => assigneeIds.has(p.user_id_1) && assigneeIds.has(p.user_id_2))
              .map((p) => ({ ids: [p.user_id_1, p.user_id_2] }));
            if (auto.length > 0) setGroups(auto);
          })
          .catch(() => {});
      }
    }).finally(() => setLoading(false));
  }, [id]);

  function getUserName(userId: string) {
    if (userId === me?.id) return me?.display_name ?? me?.email?.split('@')[0] ?? 'Me';
    const peer = peerUsers.get(userId);
    return peer?.display_name ?? peer?.email?.split('@')[0] ?? userId.slice(0, 8);
  }

  type RenderEntry =
    | { kind: 'solo'; split: SplitCalculation }
    | { kind: 'group'; idx: number; members: SplitCalculation[]; label: string; total: number };

  const renderList: RenderEntry[] = (() => {
    const result: RenderEntry[] = [];
    const emitted = new Set<number>();
    for (const split of splits) {
      const gIdx = groups.findIndex(g => g.ids.includes(split.user_id));
      if (gIdx === -1) {
        result.push({ kind: 'solo', split });
      } else if (!emitted.has(gIdx)) {
        emitted.add(gIdx);
        const members = groups[gIdx].ids.map(id => splits.find(s => s.user_id === id)!).filter(Boolean);
        result.push({ kind: 'group', idx: gIdx, members, label: groups[gIdx].ids.map(getUserName).join(' & '), total: members.reduce((s, m) => s + m.grand_total, 0) });
      }
    }
    return result;
  })();

  async function handleSettle(split: SplitCalculation, asOwner: boolean) {
    if (!id || !me || !receipt) return;
    setSettlingId(split.user_id);
    try {
      if (asOwner) {
        // Owner requesting: peer (split.user_id) paid the owner (me)
        await settle({ receipt_id: id, from_user_id: split.user_id, to_user_id: me.id, amount: split.grand_total, payment_method: 'venmo' });
      } else {
        // Non-owner paying: me paid the owner
        await settle({ receipt_id: id, from_user_id: me.id, to_user_id: receipt.owner_id, amount: split.grand_total, payment_method: 'venmo' });
      }
      setSettledIds(prev => new Set(prev).add(split.user_id));
    } finally {
      setSettlingId(null);
    }
  }

  function handleShare() {
    if (!receipt) return;
    const { blob, dataUrl } = generateSplitImage(
      receipt.restaurant_name ?? 'Receipt',
      formatDate(receipt.date),
      splits,
      peerUsers,
      me,
      groups,
      receipt.total ?? null,
    );
    const file = new File([blob], 'split.png', { type: 'image/png' });
    if (navigator.share) {
      navigator.share({ files: [file], title: `Split It: ${receipt.restaurant_name ?? 'Receipt'}` })
        .catch((err) => {
          if (err.name !== 'AbortError') setShareDataUrl(dataUrl);
        });
    } else {
      setShareDataUrl(dataUrl);
    }
  }

  if (loading) return <div className="flex h-screen items-center justify-center text-gray-400">Loading…</div>;
  if (!receipt) return <div className="flex h-screen items-center justify-center text-gray-400">Not found</div>;

  const note = `Split It: ${receipt.restaurant_name ?? 'receipt'} ${formatDate(receipt.date)}`;
  const isOwner = me && receipt.owner_id === me.id;

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-4 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-gray-500 text-sm">← Back</button>
        <div className="flex-1">
          <h1 className="font-semibold">{receipt.restaurant_name ?? 'Receipt'}</h1>
          <p className="text-xs text-gray-400">{formatDate(receipt.date)}</p>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">
        {/* Receipt totals */}
        <div className="card grid grid-cols-3 gap-3 text-center">
          {[
            { label: 'Subtotal', value: receipt.subtotal },
            { label: 'Tax', value: receipt.tax },
            { label: 'Tip', value: receipt.tip },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-xs text-gray-400">{label}</p>
              <p className="font-medium text-sm">{value != null ? formatMoney(value) : '—'}</p>
            </div>
          ))}
        </div>

        {receipt.total != null && (
          <div className="card flex items-center justify-between">
            <span className="font-bold">Total</span>
            <span className="font-bold text-lg">{formatMoney(receipt.total)}</span>
          </div>
        )}

        {/* Who owes what — directly under total */}
        {splits.length > 0 && (
          <>
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Who owes what</h2>
              <div className="flex items-center gap-3">
                {groupMode ? (
                  <>
                    <button
                      disabled={selected.size < 2}
                      onClick={() => {
                        setGroups(g => [...g, { ids: Array.from(selected) }]);
                        setSelected(new Set());
                        setGroupMode(false);
                      }}
                      className={`text-xs font-semibold ${selected.size >= 2 ? 'text-brand-600' : 'text-gray-300'}`}
                    >
                      {selected.size >= 2 ? `Group (${selected.size})` : 'Select 2+'}
                    </button>
                    <button onClick={() => { setGroupMode(false); setSelected(new Set()); }} className="text-xs text-gray-400">
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    {splits.length > 1 && (
                      <button onClick={() => setGroupMode(true)} className="text-xs text-gray-400 font-medium">
                        Group
                      </button>
                    )}
                    <button onClick={handleShare} className="flex items-center gap-1.5 text-xs font-medium text-brand-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                      </svg>
                      Share
                    </button>
                  </>
                )}
              </div>
            </div>

            {renderList.map((entry) => {
              if (entry.kind === 'solo') {
                const { split } = entry;
                const peer = peerUsers.get(split.user_id);
                const isMe = me?.id === split.user_id;
                const isSelected = selected.has(split.user_id);
                const inGroup = groups.some(g => g.ids.includes(split.user_id));
                return (
                  <div
                    key={split.user_id}
                    className={`card transition-all ${groupMode && !inGroup ? 'cursor-pointer' : ''} ${isSelected ? 'ring-2 ring-brand-500 ring-inset' : ''}`}
                    onClick={groupMode && !inGroup ? () => setSelected(prev => {
                      const next = new Set(prev);
                      if (next.has(split.user_id)) next.delete(split.user_id); else next.add(split.user_id);
                      return next;
                    }) : undefined}
                  >
                    <div className="flex items-center gap-3">
                      {groupMode && !inGroup && (
                        <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${isSelected ? 'bg-brand-600 border-brand-600' : 'border-gray-300'}`}>
                          {isSelected && (
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                      )}
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-medium text-sm">{getUserName(split.user_id)}</p>
                          <p className="font-bold text-base">{formatMoney(split.grand_total)}</p>
                        </div>
                        <p className="text-xs text-gray-400">Items {formatMoney(split.items_total)} + tax/tip {formatMoney(split.tax_tip_share)}</p>
                      </div>
                    </div>
                    {!groupMode && !settledIds.has(split.user_id) && (
                      <>
                        {/* Owner requesting payment from this person */}
                        {isOwner && !isMe && (
                          <div className="flex gap-2 mt-3">
                            {peer?.venmo_handle && (
                              <a href={venmoRequestUrl(peer.venmo_handle, split.grand_total, note)} onClick={() => handleSettle(split, true)} className="flex-1 text-center py-2 bg-[#3d95ce] text-white rounded-xl text-xs font-semibold">
                                Request via Venmo
                              </a>
                            )}
                            {me?.zelle_contact && (
                              <button onClick={async () => { await navigator.clipboard.writeText(me.zelle_contact!); alert(`Your Zelle contact copied!\nSend to them: ${me.zelle_contact}\nAmount: ${formatMoney(split.grand_total)}`); }} className="flex-1 py-2 bg-[#6d1ed4] text-white rounded-xl text-xs font-semibold">
                                Share Zelle
                              </button>
                            )}
                          </div>
                        )}
                        {/* Non-owner paying the receipt owner */}
                        {!isOwner && isMe && (
                          <div className="flex gap-2 mt-3">
                            {receipt.owner?.venmo_handle && (
                              <a href={venmoUrl(receipt.owner.venmo_handle, split.grand_total, note)} onClick={() => handleSettle(split, false)} className="flex-1 text-center py-2 bg-[#3d95ce] text-white rounded-xl text-xs font-semibold">
                                Pay via Venmo
                              </a>
                            )}
                            {receipt.owner?.zelle_contact && (
                              <button onClick={async () => { await navigator.clipboard.writeText(receipt.owner!.zelle_contact!); alert(`Zelle contact copied: ${receipt.owner!.zelle_contact}\nAmount: ${formatMoney(split.grand_total)}`); }} className="flex-1 py-2 bg-[#6d1ed4] text-white rounded-xl text-xs font-semibold">
                                Zelle info
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              }

              // Group card
              const { idx, members, label, total } = entry;
              return (
                <div key={`group-${idx}`} className="card p-0 overflow-hidden">
                  {members.map((split, mi) => (
                    <div key={split.user_id} className={`px-4 py-3 ${mi > 0 ? 'border-t border-gray-100' : ''}`}>
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-sm text-gray-700">{getUserName(split.user_id)}</p>
                        <p className="text-sm text-gray-500">{formatMoney(split.grand_total)}</p>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">Items {formatMoney(split.items_total)} + tax/tip {formatMoney(split.tax_tip_share)}</p>
                    </div>
                  ))}
                  <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-sm">{label}</p>
                      <p className="text-xs text-gray-400">Combined</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="font-bold text-base">{formatMoney(total)}</p>
                      <button onClick={() => setGroups(g => g.filter((_, i) => i !== idx))} className="text-xs text-gray-400">
                        Ungroup
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* Group assignment */}
        {availableGroups.length > 0 && (
          <div className="card space-y-2">
            <p className="text-sm font-medium text-gray-700">Group</p>
            <select
              disabled={assigningGroup}
              value={receipt.group_id ?? ''}
              onChange={async (e) => {
                const newGroupId = e.target.value || null;
                setAssigningGroup(true);
                try {
                  await assignReceiptToGroup(id!, newGroupId);
                  setReceipt((prev) => prev ? { ...prev, group_id: newGroupId } : prev);
                } finally {
                  setAssigningGroup(false);
                }
              }}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:opacity-50"
            >
              <option value="">No group</option>
              {availableGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        )}

        {/* Line items */}
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide px-1">Items</h2>
        {receipt.line_items.map((li) => (
          <div key={li.id} className="card">
            <div className="flex justify-between items-start">
              <span className="text-sm font-medium flex-1 pr-2">{li.description}</span>
              <span className="text-sm font-medium">{formatMoney(li.total_price)}</span>
            </div>
            {li.quantity > 1 && (
              <p className="text-xs text-gray-400 mt-1">{li.quantity} × {formatMoney(li.unit_price)}</p>
            )}
            {li.assignments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {li.assignments.map((a) => {
                  const u = a.user ?? peerUsers.get(a.user_id);
                  const name = a.user_id === me?.id ? (me?.display_name ?? me?.email?.split('@')[0] ?? 'Me') : (u?.display_name ?? u?.email?.split('@')[0] ?? '?');
                  return (
                    <span key={a.id} className="text-xs bg-brand-50 text-brand-700 rounded-full px-2 py-0.5">
                      {name}{li.assignments.length > 1 ? ` ${Math.round(a.fraction * 100)}%` : ''}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {me?.id === receipt.owner_id && (
          <button
            className="w-full py-3 text-sm font-medium text-red-500 rounded-2xl border border-red-100 bg-red-50 active:bg-red-100 transition-colors mt-2"
            onClick={async () => {
              if (!confirm('Delete this receipt? This cannot be undone.')) return;
              await deleteReceipt(id!);
              navigate('/', { replace: true });
            }}
          >
            Delete Receipt
          </button>
        )}
      </div>

      {/* Share image overlay — data URL so long-press share works natively on iOS */}
      {shareDataUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center gap-4 px-4"
          onClick={() => setShareDataUrl(null)}
        >
          <p className="text-white text-sm font-medium">Press and hold to share</p>
          <img
            src={shareDataUrl}
            alt="Split breakdown"
            className="w-52 rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button className="text-white/60 text-sm mt-2" onClick={() => setShareDataUrl(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
