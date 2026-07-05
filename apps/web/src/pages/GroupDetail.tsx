import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  getGroup,
  getGroupBalances,
  getGroupBreakdown,
  listGroupReceipts,
  addGroupMember,
  removeGroupMember,
  renameGroup,
  settle,
  getMe,
  searchUsers,
} from '../lib/api';
import type { BalanceSummary, GroupMember, Receipt, User } from '@split-it/types';
import type { BreakdownRow } from '../lib/api';

function formatMoney(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded-xl ${className}`} />;
}

const SWIPE_SNAP = 84;
const SWIPE_THRESHOLD = 48;

function SwipeRow({ children, onSettle, actionLabel }: { children: React.ReactNode; onSettle: () => void; actionLabel: string }) {
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

  return (
    <div className="overflow-hidden">
      <div ref={slideRef} className="flex" style={{ width: `calc(100% + ${SWIPE_SNAP}px)`, transform: `translateX(-${SWIPE_SNAP}px)` }}>
        <div className="flex-shrink-0 flex items-center justify-center bg-green-500" style={{ width: SWIPE_SNAP }}>
          <button onClick={() => { applyTransform(-SWIPE_SNAP, true); onSettle(); }} className="w-full h-full text-white font-semibold text-xs flex flex-col items-center justify-center gap-0.5">
            <span className="text-lg leading-none">✓</span>
            <span>{actionLabel}</span>
          </button>
        </div>
        <div ref={contentRef} className="flex-1 min-w-0 bg-white pl-2 pr-1">{children}</div>
      </div>
    </div>
  );
}

interface BreakdownSheet {
  balance: BalanceSummary;
  they_owe_me: BreakdownRow[];
  i_owe_them: BreakdownRow[];
  loading: boolean;
}

export default function GroupDetail() {
  const { id: groupId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [groupName, setGroupName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [balances, setBalances] = useState<BalanceSummary[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [balancesLoading, setBalancesLoading] = useState(true);
  const [receiptsLoading, setReceiptsLoading] = useState(true);

  // Bottom sheet state (same as Home)
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

  // Members sheet state
  const [showMembersSheet, setShowMembersSheet] = useState(false);
  const [membersDragY, setMembersDragY] = useState(0);
  const membersDragYRef = useRef(0);
  const membersDragging = useRef(false);
  const membersDragStartY = useRef(0);
  const membersSheetRef = useRef<HTMLDivElement>(null);
  const membersScrollRef = useRef<HTMLDivElement>(null);
  const [removingMember, setRemovingMember] = useState<string | null>(null);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<User[]>([]);
  const [memberSearching, setMemberSearching] = useState(false);
  const [pendingMembers, setPendingMembers] = useState<User[]>([]);
  const [addingMembers, setAddingMembers] = useState(false);

  useEffect(() => {
    if (!groupId) return;
    getMe().then(({ user }) => setMe(user)).catch(() => {});
    getGroup(groupId)
      .then(({ group, members: m }) => { setGroupName(group.name); setMembers(m); })
      .catch(() => {})
      .finally(() => setLoading(false));
    getGroupBalances(groupId)
      .then(({ balances: b }) => setBalances(b))
      .catch(() => {})
      .finally(() => setBalancesLoading(false));
    listGroupReceipts(groupId)
      .then(({ receipts: r }) => setReceipts(r))
      .catch(() => {})
      .finally(() => setReceiptsLoading(false));
  }, [groupId]);

  // Sheet drag-to-dismiss
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    let mode: 'undecided' | 'drag' | 'scroll' = 'undecided';
    function onStart(e: TouchEvent) { sheetDragStartY.current = e.touches[0].clientY; mode = 'undecided'; sheetDragging.current = false; }
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
      dragYRef.current = Math.max(0, dy);
      setDragY(Math.max(0, dy));
    }
    function onEnd() {
      if (mode === 'drag') { if (dragYRef.current > 80) setSheet(null); dragYRef.current = 0; setDragY(0); }
      sheetDragging.current = false;
    }
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => { el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove); el.removeEventListener('touchend', onEnd); };
  }, [sheet]);

  // Members sheet drag-to-dismiss
  useEffect(() => {
    const el = membersSheetRef.current;
    if (!el) return;
    let mode: 'undecided' | 'drag' | 'scroll' = 'undecided';
    function onStart(e: TouchEvent) { membersDragStartY.current = e.touches[0].clientY; mode = 'undecided'; membersDragging.current = false; }
    function onMove(e: TouchEvent) {
      const dy = e.touches[0].clientY - membersDragStartY.current;
      if (mode === 'undecided') {
        if (Math.abs(dy) < 5) return;
        const atTop = (membersScrollRef.current?.scrollTop ?? 0) === 0;
        mode = dy > 0 && atTop ? 'drag' : 'scroll';
        membersDragging.current = mode === 'drag';
      }
      if (mode !== 'drag') return;
      e.preventDefault();
      membersDragYRef.current = Math.max(0, dy);
      setMembersDragY(Math.max(0, dy));
    }
    function onEnd() {
      if (mode === 'drag') { if (membersDragYRef.current > 80) closeMembersSheet(); membersDragYRef.current = 0; setMembersDragY(0); }
      membersDragging.current = false;
    }
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => { el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove); el.removeEventListener('touchend', onEnd); };
  }, [showMembersSheet]);

  async function openBreakdown(b: BalanceSummary) {
    const cached = breakdownCache.current[b.peer_user_id];
    if (cached) { setSheet({ balance: b, ...cached, loading: false }); return; }
    setSheet({ balance: b, they_owe_me: [], i_owe_them: [], loading: true });
    try {
      const data = await getGroupBreakdown(groupId!, b.peer_user_id);
      breakdownCache.current[b.peer_user_id] = data;
      setSheet({ balance: b, ...data, loading: false });
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
        const updated = { ...s, they_owe_me: s.they_owe_me.filter((r) => r.receipt_id !== receiptId), i_owe_them: s.i_owe_them.filter((r) => r.receipt_id !== receiptId) };
        return updated.they_owe_me.length === 0 && updated.i_owe_them.length === 0 ? null : updated;
      });
      getGroupBalances(groupId!).then(({ balances: b }) => setBalances(b)).catch(() => {});
    } catch (e) {
      setSettleError(e instanceof Error ? e.message : 'Failed');
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
      getGroupBalances(groupId!).then(({ balances: b }) => setBalances(b)).catch(() => {});
    } catch (e) {
      setSettleError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSettling(false);
    }
  }

  // Member search
  useEffect(() => {
    if (!memberQuery.trim()) { setMemberResults([]); return; }
    setMemberSearching(true);
    const t = setTimeout(() => {
      searchUsers(memberQuery).then(({ users }) => setMemberResults(users)).catch(() => {}).finally(() => setMemberSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [memberQuery]);

  function togglePending(user: User) {
    setPendingMembers((prev) =>
      prev.some((p) => p.id === user.id) ? prev.filter((p) => p.id !== user.id) : [...prev, user]
    );
    setMemberQuery('');
    setMemberResults([]);
  }

  function closeMembersSheet() {
    setShowMembersSheet(false);
    setMemberQuery('');
    setMemberResults([]);
    setPendingMembers([]);
  }

  async function handleAddMembers() {
    if (!groupId || pendingMembers.length === 0) return;
    setAddingMembers(true);
    try {
      await Promise.all(pendingMembers.map((u) => addGroupMember(groupId, u.id)));
      const { members: m } = await getGroup(groupId);
      setMembers(m);
      setPendingMembers([]);
      setMemberQuery('');
      setMemberResults([]);
    } catch {
    } finally {
      setAddingMembers(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!groupId) return;
    setRemovingMember(userId);
    try {
      await removeGroupMember(groupId, userId);
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    } catch {
    } finally {
      setRemovingMember(null);
    }
  }

  function startEditName() {
    setNameInput(groupName);
    setEditingName(true);
    setTimeout(() => { nameInputRef.current?.focus(); nameInputRef.current?.select(); }, 0);
  }

  async function commitName() {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === groupName) { setEditingName(false); return; }
    setGroupName(trimmed);
    setEditingName(false);
    try { await renameGroup(groupId!, trimmed); } catch { setGroupName(groupName); }
  }

  const peerName = (b: BalanceSummary) => b.peer_display_name ?? b.peer_email.split('@')[0];

  const totalTheyOwe = balances.reduce((sum, b) => sum + b.they_owe, 0);
  const totalIOwe = balances.reduce((sum, b) => sum + b.you_owe, 0);
  const net = totalTheyOwe - totalIOwe;
  const myReceiptsTotal = receipts.filter((r) => r.owner_id === me?.id).reduce((sum, r) => sum + (r.total ?? 0), 0);
  const mySpend = Math.max(0, myReceiptsTotal - totalTheyOwe + totalIOwe);

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 text-lg leading-none p-1">‹</button>
          {editingName ? (
            <input
              ref={nameInputRef}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditingName(false); }}
              className="flex-1 text-lg font-bold text-gray-900 bg-transparent border-b-2 border-brand-400 outline-none min-w-0"
            />
          ) : (
            <button onClick={startEditName} className="flex-1 text-left text-lg font-bold text-gray-900 truncate">
              {loading ? '…' : groupName}
            </button>
          )}
          <button
            onClick={() => setShowMembersSheet(true)}
            className="text-sm font-medium text-gray-500 px-3 py-1.5 rounded-xl bg-gray-100 active:bg-gray-200"
          >
            {loading ? '…' : `${members.length} member${members.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>

      <div className="px-4 pt-6 space-y-6">
        {/* Summary card */}
        <div className="card">
          <div className="grid grid-cols-2 divide-x divide-gray-100">
            <div className="pr-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Net</p>
              {balancesLoading
                ? <Skeleton className="h-7 w-24 mt-1" />
                : <p className={`text-2xl font-bold ${net > 0 ? 'text-green-600' : net < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                    {net > 0 ? '+' : ''}{formatMoney(net)}
                  </p>}
              <p className="text-xs text-gray-400 mt-0.5">
                {net > 0 ? "you're owed" : net < 0 ? 'you owe' : 'all settled'}
              </p>
            </div>
            <div className="pl-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Your Spend</p>
              {receiptsLoading || balancesLoading
                ? <Skeleton className="h-7 w-24 mt-1" />
                : <p className="text-2xl font-bold text-gray-900">{formatMoney(mySpend)}</p>}
              <p className="text-xs text-gray-400 mt-0.5">your share of trip</p>
            </div>
          </div>
        </div>

        {/* Balances */}
        <section>
          {balancesLoading ? (
            <div className="space-y-2"><Skeleton className="h-4 w-24 mb-3" /><Skeleton className="h-16 w-full" /></div>
          ) : balances.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 px-1">Balances</h2>
              <div className="space-y-2">
                {balances.map((b) => (
                  <button key={b.peer_user_id} onClick={() => openBreakdown(b)} className="card w-full flex items-center justify-between text-left active:bg-gray-50 transition-colors">
                    <div>
                      <p className="font-medium text-sm">{peerName(b)}</p>
                      {b.peer_display_name && <p className="text-xs text-gray-400">{b.peer_email}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        {b.they_owe > 0
                          ? <p className="font-semibold text-green-600">+{formatMoney(b.they_owe)}</p>
                          : <p className="font-semibold text-red-500">-{formatMoney(b.you_owe)}</p>}
                        <p className="text-xs text-gray-400">{b.they_owe > 0 ? 'owes you' : 'you owe'}</p>
                      </div>
                      <span className="text-gray-300 text-sm">›</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
          {!balancesLoading && balances.length === 0 && (
            <div className="card text-center py-6">
              <p className="text-gray-400 text-sm">All settled up in this group.</p>
            </div>
          )}
        </section>

        {/* Receipts */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 px-1">Receipts</h2>
          {receiptsLoading ? (
            <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
          ) : receipts.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-gray-400 text-sm">No receipts in this group yet.</p>
              <p className="text-gray-300 text-xs mt-1">Assign a receipt to this group from its detail page.</p>
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

      {/* Members sheet */}
      {showMembersSheet && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closeMembersSheet} />
          <div
            ref={membersSheetRef}
            className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl flex flex-col max-h-[80vh]"
            style={{ transform: `translateY(${Math.max(0, membersDragY)}px)`, transition: membersDragging.current ? 'none' : 'transform 0.25s ease' }}
          >
            {/* Handle + title */}
            <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 bg-gray-200 rounded-full" /></div>
            <div className="px-6 py-3 border-b border-gray-100">
              <h3 className="font-bold text-base">Members</h3>
            </div>

            {/* Member list */}
            <div ref={membersScrollRef} className="overflow-y-auto flex-1 px-6 py-3 space-y-1">
              {members.map((m) => (
                <div key={m.user_id} className="flex items-center gap-3 py-2.5">
                  <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-sm font-semibold text-gray-600 flex-shrink-0">
                    {(m.user?.display_name ?? m.user?.email ?? '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{m.user?.display_name ?? m.user?.email?.split('@')[0]}</p>
                    {m.user?.display_name && <p className="text-xs text-gray-400">{m.user.email}</p>}
                  </div>
                  {m.user_id !== me?.id && (
                    <button
                      onClick={() => handleRemoveMember(m.user_id)}
                      disabled={removingMember === m.user_id}
                      className="text-xs text-red-400 px-2 py-1 rounded-lg active:bg-red-50 disabled:opacity-40"
                    >
                      {removingMember === m.user_id ? '…' : 'Remove'}
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Add members section */}
            <div className="border-t border-gray-100 px-6 pt-4 pb-8 space-y-3">
              {pendingMembers.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pendingMembers.map((u) => (
                    <div key={u.id} className="flex items-center gap-1.5 bg-brand-50 text-brand-700 text-xs font-medium px-3 py-1.5 rounded-full">
                      {u.display_name ?? u.email.split('@')[0]}
                      <button onPointerDown={(e) => e.preventDefault()} onClick={() => togglePending(u)} className="text-brand-400 leading-none">×</button>
                    </div>
                  ))}
                </div>
              )}
              <input
                type="text"
                placeholder="Search to add members…"
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
              {memberSearching && <p className="text-xs text-gray-400 text-center">Searching…</p>}
              {memberResults.length > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {memberResults.map((u) => {
                    const alreadyIn = members.some((m) => m.user_id === u.id);
                    const selected = pendingMembers.some((p) => p.id === u.id);
                    return (
                      <button
                        key={u.id}
                        disabled={alreadyIn}
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => togglePending(u)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left active:bg-gray-50 disabled:opacity-40"
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${selected ? 'bg-brand-500 text-white' : 'bg-gray-200 text-gray-600'}`}>
                          {selected ? '✓' : (u.display_name ?? u.email)[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{u.display_name ?? u.email.split('@')[0]}</p>
                          {u.display_name && <p className="text-xs text-gray-400">{u.email}</p>}
                        </div>
                        {alreadyIn && <span className="text-xs text-gray-400">In group</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              {pendingMembers.length > 0 && (
                <button onClick={handleAddMembers} disabled={addingMembers} className="btn-primary disabled:opacity-40">
                  {addingMembers ? 'Adding…' : `Add ${pendingMembers.length} member${pendingMembers.length > 1 ? 's' : ''}`}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Balance breakdown bottom sheet */}
      {sheet && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => { setSheet(null); setDragY(0); }} />
          <div
            ref={sheetRef}
            className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl max-h-[80vh] flex flex-col"
            style={{ transform: `translateY(${Math.max(0, dragY)}px)`, transition: sheetDragging.current ? 'none' : 'transform 0.25s ease' }}
          >
            <div className="select-none">
              <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 bg-gray-200 rounded-full" /></div>
              <div className="px-6 py-3 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-base">{peerName(sheet.balance)}</h2>
                    <p className="text-xs text-gray-400 mt-0.5">{sheet.balance.peer_email}</p>
                  </div>
                  <div className="text-right">
                    {sheet.balance.they_owe > 0
                      ? <><button onClick={() => { const a = sheet.balance.they_owe; setCopyToast(`$${a.toFixed(2)} copied`); setTimeout(() => setCopyToast(''), 1500); navigator.clipboard?.writeText(a.toFixed(2)).catch(() => {}); }} className="font-bold text-green-600 text-lg active:opacity-60">{formatMoney(sheet.balance.they_owe)}</button><p className="text-xs text-gray-400">owes you</p></>
                      : <><button onClick={() => { const a = sheet.balance.you_owe; setCopyToast(`$${a.toFixed(2)} copied`); setTimeout(() => setCopyToast(''), 1500); navigator.clipboard?.writeText(a.toFixed(2)).catch(() => {}); }} className="font-bold text-red-500 text-lg active:opacity-60">{formatMoney(sheet.balance.you_owe)}</button><p className="text-xs text-gray-400">you owe</p></>}
                  </div>
                </div>
              </div>
            </div>

            <div ref={scrollRef} className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
              {sheet.loading ? (
                <p className="text-gray-400 text-sm text-center py-6">Loading breakdown…</p>
              ) : (
                <>
                  {sheet.they_owe_me.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{peerName(sheet.balance)} owes you</p>
                      <div className="space-y-2">
                        {sheet.they_owe_me.map((row) => (
                          <SwipeRow key={row.receipt_id} actionLabel="Received" onSettle={() => me && settleRow(row.receipt_id, me.id, row.amount, sheet.balance.peer_user_id)}>
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
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">You owe {peerName(sheet.balance)}</p>
                      <div className="space-y-2">
                        {sheet.i_owe_them.map((row) => (
                          <SwipeRow key={row.receipt_id} actionLabel="Paid" onSettle={() => settleRow(row.receipt_id, sheet.balance.peer_user_id, row.amount)}>
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
                    <p className="text-gray-400 text-sm text-center py-6">No outstanding amounts.</p>
                  )}
                </>
              )}
            </div>

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
                <button onClick={() => settleAll('other')} disabled={settling} className="btn-secondary">
                  {settling ? 'Recording…' : sheet.balance.you_owe > 0 ? 'Mark as paid' : 'Mark as received'}
                </button>
                <button onClick={() => setSheet(null)} className="w-full text-center text-sm text-gray-400 py-1">Close</button>
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
