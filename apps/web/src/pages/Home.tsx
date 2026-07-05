import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getBalances, listReceipts, getBalanceBreakdown, settle, getMe, listGroups, createGroup, type BreakdownRow } from '../lib/api';
import type { BalanceSummary, GroupSummary, Receipt, User } from '@split-it/types';

function formatMoney(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface BreakdownSheet {
  balance: BalanceSummary;
  they_owe_me: BreakdownRow[];
  i_owe_them: BreakdownRow[];
  loading: boolean;
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded-xl ${className}`} />;
}

const SWIPE_SNAP = 84;
const SWIPE_THRESHOLD = 48;

function SwipeRow({
  children,
  onSettle,
  actionColor,
  actionLabel,
}: {
  children: React.ReactNode;
  onSettle: () => void;
  actionColor: 'green' | 'gray';
  actionLabel: string;
}) {
  const slideRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const currentTx = useRef(-SWIPE_SNAP);
  const gestureBase = useRef(-SWIPE_SNAP);
  const startX = useRef(0);
  const startY = useRef(0);
  const dirLocked = useRef<'h' | 'v' | null>(null);
  const isDragging = useRef(false);

  function applyTransform(tx: number, animate: boolean) {
    const el = slideRef.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none';
    el.style.transform = `translateX(${tx}px)`;
    currentTx.current = tx;
  }

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    function onStart(e: TouchEvent) {
      startX.current = e.touches[0].clientX;
      startY.current = e.touches[0].clientY;
      gestureBase.current = currentTx.current;
      dirLocked.current = null;
      isDragging.current = false;
    }

    function onMove(e: TouchEvent) {
      const dx = e.touches[0].clientX - startX.current;
      const dy = e.touches[0].clientY - startY.current;
      if (!dirLocked.current) {
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        dirLocked.current = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
        isDragging.current = dirLocked.current === 'h';
        if (!isDragging.current) return;
      }
      if (!isDragging.current) return;
      e.preventDefault();
      applyTransform(Math.min(Math.max(-SWIPE_SNAP, gestureBase.current + dx), 20), false);
    }

    function onEnd() {
      if (!isDragging.current) return;
      isDragging.current = false;
      const open = currentTx.current > -(SWIPE_SNAP - SWIPE_THRESHOLD);
      applyTransform(open ? 0 : -SWIPE_SNAP, true);
    }

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, []);

  function handleSettle() {
    applyTransform(-SWIPE_SNAP, true);
    onSettle();
  }

  const bg = actionColor === 'green' ? 'bg-green-500' : 'bg-blue-500';

  return (
    <div className="overflow-hidden">
      <div
        ref={slideRef}
        className="flex"
        style={{ width: `calc(100% + ${SWIPE_SNAP}px)`, transform: `translateX(-${SWIPE_SNAP}px)` }}
      >
        <div
          className={`flex-shrink-0 flex items-center justify-center ${bg}`}
          style={{ width: SWIPE_SNAP }}
        >
          <button
            onClick={handleSettle}
            className="w-full h-full text-white font-semibold text-xs flex flex-col items-center justify-center gap-0.5"
          >
            <span className="text-lg leading-none">✓</span>
            <span>{actionLabel}</span>
          </button>
        </div>
        <div ref={contentRef} className="flex-1 min-w-0 bg-white pl-2 pr-1">
          {children}
        </div>
      </div>
    </div>
  );
}


export default function Home() {
  const navigate = useNavigate();
  const [balances, setBalances] = useState<BalanceSummary[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(true);
  const [receiptsLoading, setReceiptsLoading] = useState(true);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [newGroupName, setNewGroupName] = useState('');
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState<BreakdownSheet | null>(null);
  const [settling, setSettling] = useState(false);
  const [settleError, setSettleError] = useState('');
  const [copyToast, setCopyToast] = useState('');
  const [dragY, setDragY] = useState(0);
  const dragYRef = useRef(0);
  const sheetDragging = useRef(false);
  const sheetDragStartY = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const breakdownCache = useRef<Record<string, { they_owe_me: BreakdownRow[]; i_owe_them: BreakdownRow[] }>>({});
  const [me, setMe] = useState<User | null>(null);

  useEffect(() => { getMe().then(({ user }) => setMe(user)).catch(() => {}); }, []);

  useEffect(() => {
    getBalances()
      .then((b) => setBalances(b.balances))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBalancesLoading(false));

    listReceipts()
      .then((r) => setReceipts(r.receipts))
      .catch(() => {})
      .finally(() => setReceiptsLoading(false));

    listGroups()
      .then(({ groups: g }) => setGroups(g))
      .catch(() => {})
      .finally(() => setGroupsLoading(false));
  }, []);

  // Pre-warm breakdown cache for all of the current user's balances
  useEffect(() => {
    for (const b of balances) {
      if (breakdownCache.current[b.peer_user_id]) continue;
      getBalanceBreakdown(b.peer_user_id)
        .then((data) => { breakdownCache.current[b.peer_user_id] = data; })
        .catch(() => {});
    }
  }, [balances]);

  // Sheet drag-to-dismiss: works anywhere on the sheet.
  // Only enters drag mode when swiping down AND the scroll list is already at the top,
  // so normal list scrolling isn't intercepted.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;

    let mode: 'undecided' | 'drag' | 'scroll' = 'undecided';

    function onStart(e: TouchEvent) {
      sheetDragStartY.current = e.touches[0].clientY;
      mode = 'undecided';
      sheetDragging.current = false;
    }
    function onMove(e: TouchEvent) {
      const dy = e.touches[0].clientY - sheetDragStartY.current;
      if (mode === 'undecided') {
        if (Math.abs(dy) < 5) return;
        const atTop = (scrollRef.current?.scrollTop ?? 0) === 0;
        mode = dy > 0 && atTop ? 'drag' : 'scroll';
        sheetDragging.current = mode === 'drag';
      }
      if (mode !== 'drag') return;
      e.preventDefault();
      const translateY = Math.max(0, dy);
      dragYRef.current = translateY;
      setDragY(translateY);
    }
    function onEnd() {
      if (mode === 'drag') {
        if (dragYRef.current > 80) setSheet(null);
        dragYRef.current = 0;
        setDragY(0);
      }
      sheetDragging.current = false;
    }

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [sheet]);

  async function openBreakdown(b: BalanceSummary) {
    const cached = breakdownCache.current[b.peer_user_id];
    if (cached) {
      setSheet({ balance: b, they_owe_me: cached.they_owe_me, i_owe_them: cached.i_owe_them, loading: false });
      return;
    }
    setSheet({ balance: b, they_owe_me: [], i_owe_them: [], loading: true });
    try {
      const data = await getBalanceBreakdown(b.peer_user_id);
      breakdownCache.current[b.peer_user_id] = data;
      setSheet({ balance: b, they_owe_me: data.they_owe_me, i_owe_them: data.i_owe_them, loading: false });
    } catch {
      setSheet((prev) => prev ? { ...prev, loading: false } : null);
    }
  }


  async function settleRow(receiptId: string, toUserId: string, amount: number, fromUserId?: string) {
    setSettleError('');
    try {
      await settle({ receipt_id: receiptId, to_user_id: toUserId, from_user_id: fromUserId, amount, payment_method: 'other' });
      if (sheet) delete breakdownCache.current[sheet.balance.peer_user_id];
      setSheet((s) => {
        if (!s) return null;
        const updated = {
          ...s,
          they_owe_me: s.they_owe_me.filter((r) => r.receipt_id !== receiptId),
          i_owe_them: s.i_owe_them.filter((r) => r.receipt_id !== receiptId),
        };
        return updated.they_owe_me.length === 0 && updated.i_owe_them.length === 0 ? null : updated;
      });
      getBalances().then((b) => setBalances(b.balances)).catch(() => {});
    } catch (e) {
      setSettleError(e instanceof Error ? e.message : 'Failed to record payment');
    }
  }

  async function settleAll(method: 'venmo' | 'zelle' | 'cash' | 'other') {
    if (!sheet || !me) return;
    setSettling(true);
    setSettleError('');
    const { peer_user_id } = sheet.balance;
    try {
      await Promise.all([
        ...sheet.i_owe_them.map((r) => settle({ receipt_id: r.receipt_id, to_user_id: peer_user_id, amount: r.amount, payment_method: method })),
        ...sheet.they_owe_me.map((r) => settle({ receipt_id: r.receipt_id, from_user_id: peer_user_id, to_user_id: me.id, amount: r.amount, payment_method: method })),
      ]);
      setSheet(null);
      getBalances().then((b) => setBalances(b.balances)).catch(() => {});
    } catch (e) {
      setSettleError(e instanceof Error ? e.message : 'Failed to record payment');
    } finally {
      setSettling(false);
    }
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    setCreatingGroup(true);
    try {
      const { group } = await createGroup(newGroupName.trim());
      setShowNewGroup(false);
      setNewGroupName('');
      navigate(`/groups/${group.id}`);
    } catch {
    } finally {
      setCreatingGroup(false);
    }
  }

  const totalOwed = balances.reduce((s, b) => s + b.they_owe, 0);
  const totalOwing = balances.reduce((s, b) => s + b.you_owe, 0);
  const net = totalOwed - totalOwing;
  const totalFlow = totalOwed + totalOwing;
  const owedPct = totalFlow > 0 ? (totalOwed / totalFlow) * 100 : 50;
  const peerName = (b: BalanceSummary) => me?.id === b.peer_user_id ? 'Me' : (b.peer_display_name ?? b.peer_email.split('@')[0]);

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      {/* Top bar */}
      <div className="bg-white shadow-sm flex items-center justify-between px-6 pb-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}>
        <span className="text-lg font-bold text-gray-900 tracking-tight">Split It</span>
        <Link to="/profile" className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 text-sm font-semibold">
          {(me?.display_name?.[0] ?? me?.email?.[0] ?? '?').toUpperCase()}
        </Link>
      </div>

      <div className="px-4 pt-6 space-y-6">
        {/* Summary card */}
        <div className="card">
          <div className="flex gap-4 mb-4">
            <div className="flex-1">
              <p className="text-xs font-semibold text-green-700 uppercase tracking-widest mb-1">You're owed</p>
              {balancesLoading ? <Skeleton className="h-8 w-24 mt-1" /> : <p className="text-2xl font-bold text-green-600">{formatMoney(totalOwed)}</p>}
            </div>
            <div className="w-px bg-gray-100 self-stretch" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-red-600 uppercase tracking-widest mb-1">You owe</p>
              {balancesLoading ? <Skeleton className="h-8 w-20 mt-1" /> : <p className="text-2xl font-bold text-red-500">{formatMoney(totalOwing)}</p>}
            </div>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-gray-100 flex">
            {balancesLoading ? (
              <div className="bg-gray-200 w-full rounded-full animate-pulse" />
            ) : totalFlow > 0 ? (
              <>
                <div className="bg-green-600 rounded-l-full transition-all duration-500" style={{ width: `${owedPct}%` }} />
                <div className="bg-red-500 flex-1 rounded-r-full transition-all duration-500" />
              </>
            ) : (
              <div className="bg-gray-200 w-full rounded-full" />
            )}
          </div>
          <p className={`text-xs font-medium mt-1.5 text-center ${net > 0 ? 'text-green-600' : net < 0 ? 'text-red-500' : 'text-gray-400'}`}>
            {balancesLoading ? <Skeleton className="h-3 w-20 mx-auto" /> : totalFlow === 0 ? 'All settled up' : net > 0 ? `Net +${formatMoney(net)}` : `Net ${formatMoney(net)}`}
          </p>
        </div>
        {error && (
          <div className="card bg-red-50 border-red-100 text-red-700 text-sm">
            <p className="font-medium">Error loading data</p>
            <p className="text-xs mt-1 font-mono break-all">{error}</p>
          </div>
        )}

        {/* Groups */}
        <section>
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Groups</h2>
            <button onClick={() => setShowNewGroup(true)} className="text-xs font-medium text-brand-600 px-2.5 py-1 rounded-lg bg-brand-50 active:bg-brand-100">
              + New
            </button>
          </div>
          {groupsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
            </div>
          ) : groups.length === 0 ? (
            <button onClick={() => setShowNewGroup(true)} className="card w-full text-center py-5 active:bg-gray-50">
              <p className="text-gray-400 text-sm">No groups yet.</p>
              <p className="text-brand-600 text-xs font-medium mt-1">Create one for a trip or event</p>
            </button>
          ) : (
            <div className="space-y-2">
              {groups.map((g) => (
                <button key={g.id} onClick={() => navigate(`/groups/${g.id}`)} className="card w-full flex items-center justify-between text-left active:bg-gray-50 transition-colors">
                  <div className="flex-1 min-w-0 mr-3">
                    <p className="font-medium text-sm truncate">{g.name}</p>
                    <div className="flex gap-1 mt-1.5">
                      {g.members.slice(0, 5).map((m) => (
                        <div key={m.id} className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-semibold text-gray-600">
                          {(m.display_name ?? m.email)[0].toUpperCase()}
                        </div>
                      ))}
                      {g.member_count > 5 && <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-[10px] text-gray-400">+{g.member_count - 5}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="text-right">
                      {g.they_owe > 0
                        ? <><p className="font-semibold text-green-600 text-sm">+{formatMoney(g.they_owe)}</p><p className="text-xs text-gray-400">owed to you</p></>
                        : g.you_owe > 0
                          ? <><p className="font-semibold text-red-500 text-sm">-{formatMoney(g.you_owe)}</p><p className="text-xs text-gray-400">you owe</p></>
                          : <p className="text-xs text-gray-400">Settled up</p>}
                    </div>
                    <span className="text-gray-300 text-sm">›</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Balances */}
        <section>
          {balancesLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-24 mb-3" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : balances.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 px-1">Balances</h2>
              <div className="space-y-2">
                {balances.map((b) => (
                  <button
                    key={b.peer_user_id}
                    onClick={() => openBreakdown(b)}
                    className="card w-full flex items-center justify-between text-left active:bg-gray-50 transition-colors"
                  >
                    <div>
                      <p className="font-medium text-sm">{peerName(b)}</p>
                      {b.peer_display_name && <p className="text-xs text-gray-400">{b.peer_email}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        {b.they_owe > 0 ? (
                          <p className="font-semibold text-green-600">+{formatMoney(b.they_owe)}</p>
                        ) : (
                          <p className="font-semibold text-red-500">-{formatMoney(b.you_owe)}</p>
                        )}
                        <p className="text-xs text-gray-400">{b.they_owe > 0 ? 'owes you' : 'you owe'}</p>
                      </div>
                      <span className="text-gray-300 text-sm">›</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        {/* Recent receipts */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 px-1">Recent receipts</h2>
          {receiptsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : receipts.length === 0 ? (
            <div className="card text-center py-10">
              <p className="text-gray-400 text-sm">No receipts yet.</p>
              <p className="text-gray-300 text-xs mt-1">Tap + to add your first one.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {receipts.map((r) => (
                <Link key={r.id} to={`/receipts/${r.id}`} className="card flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{r.restaurant_name ?? 'Receipt'}</p>
                    <p className="text-xs text-gray-400">{formatDate(r.date)}</p>
                  </div>
                  <p className="font-semibold text-sm">{r.total != null ? formatMoney(r.total) : '—'}</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>


      {/* New group modal */}
      {showNewGroup && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => { setShowNewGroup(false); setNewGroupName(''); }} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl p-6 pb-10">
            <h3 className="font-bold text-base mb-4">New Group</h3>
            <input
              autoFocus
              type="text"
              placeholder="Group name (e.g. Cancun 2026)"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 mb-3"
            />
            <button onClick={handleCreateGroup} disabled={creatingGroup || !newGroupName.trim()} className="btn-primary w-full">
              {creatingGroup ? 'Creating…' : 'Create Group'}
            </button>
          </div>
        </>
      )}

      {/* Balance breakdown bottom sheet */}
      {sheet && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => { setSheet(null); setDragY(0); }}
          />

          {/* Sheet */}
          <div
            ref={sheetRef}
            className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl max-h-[80vh] flex flex-col"
            style={{ transform: `translateY(${Math.max(0, dragY)}px)`, transition: sheetDragging.current ? 'none' : 'transform 0.25s ease' }}
          >
            {/* Handle + title */}
            <div className="select-none">
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 bg-gray-200 rounded-full" />
              </div>
              <div className="px-6 py-3 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-base">{peerName(sheet.balance)}</h2>
                    <p className="text-xs text-gray-400 mt-0.5">{sheet.balance.peer_email}</p>
                  </div>
                  <div className="text-right">
                    {sheet.balance.they_owe > 0 ? (
                      <>
                        <button onClick={() => { const a = sheet.balance.they_owe; setCopyToast(`$${a.toFixed(2)} copied`); setTimeout(() => setCopyToast(''), 1500); navigator.clipboard?.writeText(a.toFixed(2)).catch(() => {}); }} className="font-bold text-green-600 text-lg active:opacity-60">{formatMoney(sheet.balance.they_owe)}</button>
                        <p className="text-xs text-gray-400">owes you</p>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { const a = sheet.balance.you_owe; setCopyToast(`$${a.toFixed(2)} copied`); setTimeout(() => setCopyToast(''), 1500); navigator.clipboard?.writeText(a.toFixed(2)).catch(() => {}); }} className="font-bold text-red-500 text-lg active:opacity-60">{formatMoney(sheet.balance.you_owe)}</button>
                        <p className="text-xs text-gray-400">you owe</p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Breakdown list */}
            <div ref={scrollRef} className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
              {sheet.loading ? (
                <p className="text-gray-400 text-sm text-center py-6">Loading breakdown…</p>
              ) : (
                <>
                  {sheet.they_owe_me.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                        {peerName(sheet.balance)} owes you
                      </p>
                      <div className="space-y-2">
                        {sheet.they_owe_me.map((row) => (
                          <SwipeRow
                            key={row.receipt_id}
                            actionColor="green"
                            actionLabel="Received"
                            onSettle={() => me && settleRow(row.receipt_id, me.id, row.amount, sheet.balance.peer_user_id)}
                          >
                            <div className="flex items-center justify-between py-3 border-b border-gray-50">
                              <Link to={`/receipts/${row.receipt_id}`} onClick={() => setSheet(null)} className="flex-1 min-w-0">
                                <p className="text-sm font-medium">{row.restaurant_name ?? 'Receipt'}</p>
                                <p className="text-xs text-gray-400">{formatDate(row.date)}</p>
                              </Link>
                              <button onClick={() => { setCopyToast(`$${row.amount.toFixed(2)} copied`); setTimeout(() => setCopyToast(''), 1500); navigator.clipboard?.writeText(row.amount.toFixed(2)).catch(() => {}); }} className="font-semibold text-sm text-green-600 ml-2 flex-shrink-0 active:opacity-60">+{formatMoney(row.amount)}</button>
                            </div>
                          </SwipeRow>
                        ))}
                      </div>
                    </div>
                  )}

                  {sheet.i_owe_them.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                        You owe {peerName(sheet.balance)}
                      </p>
                      <div className="space-y-2">
                        {sheet.i_owe_them.map((row) => (
                          <SwipeRow
                            key={row.receipt_id}
                            actionColor="gray"
                            actionLabel="Paid"
                            onSettle={() => settleRow(row.receipt_id, sheet.balance.peer_user_id, row.amount)}
                          >
                            <div className="flex items-center justify-between py-3 border-b border-gray-50">
                              <Link to={`/receipts/${row.receipt_id}`} onClick={() => setSheet(null)} className="flex-1 min-w-0">
                                <p className="text-sm font-medium">{row.restaurant_name ?? 'Receipt'}</p>
                                <p className="text-xs text-gray-400">{formatDate(row.date)}</p>
                              </Link>
                              <button onClick={() => { setCopyToast(`$${row.amount.toFixed(2)} copied`); setTimeout(() => setCopyToast(''), 1500); navigator.clipboard?.writeText(row.amount.toFixed(2)).catch(() => {}); }} className="font-semibold text-sm text-red-500 ml-2 flex-shrink-0 active:opacity-60">-{formatMoney(row.amount)}</button>
                            </div>
                          </SwipeRow>
                        ))}
                      </div>
                    </div>
                  )}

                  {sheet.they_owe_me.length === 0 && sheet.i_owe_them.length === 0 && (
                    <p className="text-gray-400 text-sm text-center py-6">No receipt breakdown found.</p>
                  )}
                </>
              )}
            </div>

            {/* Actions */}
            {!sheet.loading && (
              <div className="px-6 pb-8 pt-3 border-t border-gray-100 space-y-2">
                {settleError && <p className="text-xs text-red-500">{settleError}</p>}
                {sheet.balance.you_owe > 0 && sheet.balance.peer_venmo_handle && (
                  <a
                    href={`venmo://paycharge?txn=pay&recipients=${encodeURIComponent(sheet.balance.peer_venmo_handle)}&amount=${sheet.balance.you_owe.toFixed(2)}&note=${encodeURIComponent('Split It')}`}
                    onClick={() => settleAll('venmo')}
                    className="btn-primary text-center block"
                    style={{ backgroundColor: '#3d95ce' }}
                  >
                    Pay ${sheet.balance.you_owe.toFixed(2)} via Venmo
                  </a>
                )}
                {sheet.balance.you_owe > 0 && sheet.balance.peer_zelle_contact && (
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(sheet.balance.peer_zelle_contact!);
                      await settleAll('zelle');
                    }}
                    className="btn-primary"
                    style={{ backgroundColor: '#6d1ed4' }}
                  >
                    Pay via Zelle (contact copied)
                  </button>
                )}
                <button
                  onClick={() => settleAll('other')}
                  disabled={settling}
                  className="btn-secondary"
                >
                  {settling ? 'Recording…' : sheet.balance.you_owe > 0 ? 'Mark as paid' : 'Mark as received'}
                </button>
                <button onClick={() => setSheet(null)} className="w-full text-center text-sm text-gray-400 py-1">
                  Close
                </button>
              </div>
            )}
            {sheet.loading && (
              <div className="px-6 pb-8 pt-3 border-t border-gray-100">
                <button onClick={() => setSheet(null)} className="btn-secondary">Close</button>
              </div>
            )}
          </div>
        </>
      )}

      {copyToast && (
        <div className="fixed inset-0 flex items-center justify-center z-[999] pointer-events-none">
          <div className="bg-gray-900 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-2xl">
            {copyToast}
          </div>
        </div>
      )}
    </div>
  );
}
