import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  getGroupMySpend,
  getGroupPairs,
  addGroupPair,
  removeGroupPair,
} from '../lib/api';
import type { GroupPair } from '../lib/api';
import type { BalanceSummary, GroupMember, Receipt, User } from '@split-it/types';
import type { BreakdownRow } from '../lib/api';

function formatMoney(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatZelleContact(contact: string): { display: string; copyText: string } {
  const digits = contact.replace(/\D/g, '');
  if (!contact.includes('@') && (digits.length === 10 || digits.length === 11)) {
    const d = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
    if (d.length === 10)
      return { display: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, copyText: digits };
  }
  return { display: contact, copyText: contact };
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded-xl ${className}`} />;
}

function VenmoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="white">
      <path d="M18.4 3c.5.9.7 1.9.7 3.2 0 4-3.4 9.2-6.1 12.8H7.4L5 4.5l5.4-.5 1.3 10.8C13 12.3 14.8 8.8 14.8 6.2c0-1.2-.2-2.1-.6-2.9L18.4 3z" />
    </svg>
  );
}

function ZelleIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="14 9 20 30" className={className}>
      <path fill="#fff" d="M17.5,18.5h14c0.552,0,1-0.448,1-1V15c0-0.552-0.448-1-1-1h-14c-0.552,0-1,0.448-1,1v2.5C16.5,18.052,16.948,18.5,17.5,18.5z"/>
      <path fill="#fff" d="M17,34.5h14.5c0.552,0,1-0.448,1-1V31c0-0.552-0.448-1-1-1H17c-0.552,0-1,0.448-1,1v2.5C16,34.052,16.448,34.5,17,34.5z"/>
      <path fill="#fff" d="M22.25,11v6c0,0.276,0.224,0.5,0.5,0.5h3.5c0.276,0,0.5-0.224,0.5-0.5v-6c0-0.276-0.224-0.5-0.5-0.5h-3.5C22.474,10.5,22.25,10.724,22.25,11z"/>
      <path fill="#fff" d="M22.25,32v6c0,0.276,0.224,0.5,0.5,0.5h3.5c0.276,0,0.5-0.224,0.5-0.5v-6c0-0.276-0.224-0.5-0.5-0.5h-3.5C22.474,31.5,22.25,31.724,22.25,32z"/>
      <path fill="#fff" d="M16.578,30.938H22l10.294-12.839c0.178-0.222,0.019-0.552-0.266-0.552H26.5L16.275,30.298C16.065,30.553,16.247,30.938,16.578,30.938z"/>
    </svg>
  );
}

function ZelleFields({ contact, amount, onCopy }: { contact: string; amount: number; onCopy: (text: string) => void }) {
  const { display, copyText } = formatZelleContact(contact);
  return (
    <div className="space-y-3 mb-5">
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Account</p>
        <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-4 py-3 cursor-pointer active:bg-gray-100" onClick={() => onCopy(copyText)}>
          <p className="flex-1 text-gray-800 font-medium text-sm">{display}</p>
          <span className="text-purple-600 flex-shrink-0"><CopyIcon /></span>
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Amount</p>
        <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-4 py-3 cursor-pointer active:bg-gray-100" onClick={() => onCopy(amount.toFixed(2))}>
          <p className="flex-1 text-gray-900 font-bold text-xl">${amount.toFixed(2)}</p>
          <span className="text-purple-600 flex-shrink-0"><CopyIcon /></span>
        </div>
      </div>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="w-9 h-9 rounded-full flex items-center justify-center bg-gray-200 text-gray-600 font-bold text-sm flex-shrink-0">
      {(name[0] ?? '?').toUpperCase()}
    </div>
  );
}

function PairAvatar({ name1, name2 }: { name1: string; name2: string }) {
  return (
    <div className="relative w-9 h-9 flex-shrink-0">
      <div className="absolute top-0 left-0 w-6 h-6 rounded-full bg-gray-200 text-gray-600 font-bold text-xs flex items-center justify-center">
        {(name1[0] ?? '?').toUpperCase()}
      </div>
      <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-gray-300 text-gray-600 font-bold text-xs flex items-center justify-center border border-white">
        {(name2[0] ?? '?').toUpperCase()}
      </div>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}


function mergeBalancesWithPairs(
  balances: BalanceSummary[],
  pairs: GroupPair[],
  members: GroupMember[],
  meId: string | undefined,
): BalanceSummary[] {
  const memberName = (uid: string) => {
    if (uid === meId) return 'Me';
    const m = members.find((mm) => mm.user_id === uid);
    return m ? (m.user?.display_name ?? m.user?.email?.split('@')[0] ?? '?') : '?';
  };

  const result: BalanceSummary[] = [...balances];
  for (const pair of pairs) {
    const [uid1, uid2] = [pair.user_id_1, pair.user_id_2];
    const idx1 = result.findIndex((b) => b.peer_user_id === uid1);
    const idx2 = result.findIndex((b) => b.peer_user_id === uid2);

    if (idx1 !== -1 && idx2 !== -1) {
      // Both have balances — normal two-sided merge
      const b1 = result[idx1];
      const b2 = result[idx2];
      const [lo, hi] = idx1 < idx2 ? [idx1, idx2] : [idx2, idx1];
      result.splice(hi, 1);
      result.splice(lo, 1);
      const rawNet = (b1.they_owe + b2.they_owe) - (b1.you_owe + b2.you_owe);
      const name1 = b1.peer_display_name ?? b1.peer_email.split('@')[0];
      const name2 = b2.peer_display_name ?? b2.peer_email.split('@')[0];
      result.push({
        peer_user_id: pair.id,
        peer_email: '',
        peer_display_name: `${name1} & ${name2}`,
        peer_venmo_handle: null,
        peer_zelle_contact: null,
        net_amount: rawNet,
        they_owe: rawNet > 0 ? rawNet : 0,
        you_owe: rawNet < 0 ? -rawNet : 0,
        pair_member_ids: [uid1, uid2],
      });
    } else if (idx1 !== -1 || idx2 !== -1) {
      // One-sided — rename the present member's card to include both names
      const presentIdx = idx1 !== -1 ? idx1 : idx2;
      const presentUid = idx1 !== -1 ? uid1 : uid2;
      const absentUid = idx1 !== -1 ? uid2 : uid1;
      const b = result[presentIdx];
      const presentName = b.peer_display_name ?? b.peer_email.split('@')[0];
      const absentName = memberName(absentUid);
      const displayName = absentUid === meId
        ? presentName
        : (presentUid === uid1 ? `${presentName} & ${absentName}` : `${absentName} & ${presentName}`);
      result[presentIdx] = { ...b, peer_display_name: displayName, pair_member_ids: [uid1, uid2] };
    }
    // Neither has a balance — pair stored but nothing to show yet
  }
  return result;
}

const SWIPE_THRESHOLD = 48;
const ACTION_W = 72;
let _activeSwipeClose: (() => void) | null = null;

interface SwipeAction {
  label: string;
  bgColor: string;
  icon: React.ReactNode;
  onClick: () => void;
}

function SwipeRow({ children, actions, className = 'overflow-hidden' }: { children: React.ReactNode; actions: SwipeAction[]; className?: string }) {
  const SNAP = actions.length * ACTION_W;
  const slideRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const currentTx = useRef(-SNAP);
  const gestureBase = useRef(-SNAP);
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

    function closeThis() {
      applyTransform(-SNAP, true);
      if (_activeSwipeClose === closeThis) _activeSwipeClose = null;
      document.removeEventListener('touchstart', handleOutsideTap, { capture: true } as EventListenerOptions);
    }

    function handleOutsideTap(e: TouchEvent) {
      const container = slideRef.current?.parentElement;
      if (container && !container.contains(e.target as Node)) closeThis();
    }

    function onStart(e: TouchEvent) {
      if (_activeSwipeClose && _activeSwipeClose !== closeThis) _activeSwipeClose();
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
      applyTransform(Math.min(Math.max(-SNAP, gestureBase.current + dx), 20), false);
    }
    function onEnd() {
      if (!isDragging.current) return;
      isDragging.current = false;
      const open = currentTx.current > -(SNAP - SWIPE_THRESHOLD);
      if (open) {
        _activeSwipeClose = closeThis;
        document.addEventListener('touchstart', handleOutsideTap, { passive: true, capture: true });
      } else {
        if (_activeSwipeClose === closeThis) _activeSwipeClose = null;
        document.removeEventListener('touchstart', handleOutsideTap, { capture: true } as EventListenerOptions);
      }
      applyTransform(open ? 0 : -SNAP, true);
    }
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchstart', handleOutsideTap, { capture: true } as EventListenerOptions);
      if (_activeSwipeClose === closeThis) _activeSwipeClose = null;
    };
  }, [SNAP]);

  return (
    <div className={className}>
      <div ref={slideRef} className="flex" style={{ width: `calc(100% + ${SNAP}px)`, transform: `translateX(-${SNAP}px)` }}>
        <div className="flex-shrink-0 flex" style={{ width: SNAP }}>
          {actions.map((a, i) => (
            <button
              key={i}
              onClick={() => { applyTransform(-SNAP, true); a.onClick(); }}
              className="flex-1 h-full text-white text-xs font-semibold flex flex-col items-center justify-center gap-0.5"
              style={{ backgroundColor: a.bgColor }}
            >
              {a.icon}
              <span>{a.label}</span>
            </button>
          ))}
        </div>
        <div ref={contentRef} className="flex-1 min-w-0 bg-white">{children}</div>
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

function stripEmojis(str: string) {
  return str.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
}

function generateGroupShareImage(
  name: string,
  rawBalances: BalanceSummary[],
  pairs: GroupPair[],
  getMemberName: (uid: string) => string,
): { blob: Blob; dataUrl: string } {
  const SCALE = 2;
  const W = 260;
  const PAD = 16;
  const MONO = 'monospace';
  const HEADER_H = 64;
  const DIVPAD = 23;
  const DIVPAD_SM = 20;
  const NAME_LS = 18;
  const PERSON_GAP = 6;
  const SUBTOTAL_LS = 16;
  const GROUP_SEP_H = 18;

  type DrawRow =
    | { kind: 'person'; name: string; net: number }
    | { kind: 'subtotal'; label: string; net: number };

  const getName = (b: BalanceSummary) => b.peer_display_name ?? b.peer_email.split('@')[0];
  // Only include people who owe the user
  const activeBalances = rawBalances.filter(b => b.they_owe > 0);

  const drawRows: DrawRow[] = [];
  const emittedPairs = new Set<string>();

  for (const b of activeBalances) {
    const pair = pairs.find(p => p.user_id_1 === b.peer_user_id || p.user_id_2 === b.peer_user_id);
    if (!pair) {
      drawRows.push({ kind: 'person', name: getName(b), net: b.they_owe });
    } else if (!emittedPairs.has(pair.id)) {
      emittedPairs.add(pair.id);
      const b1 = rawBalances.find(x => x.peer_user_id === pair.user_id_1);
      const b2 = rawBalances.find(x => x.peer_user_id === pair.user_id_2);
      if (b1 && b1.they_owe > 0) drawRows.push({ kind: 'person', name: getName(b1), net: b1.they_owe });
      if (b2 && b2.they_owe > 0) drawRows.push({ kind: 'person', name: getName(b2), net: b2.they_owe });
      if (b1 && b2 && b1.they_owe > 0 && b2.they_owe > 0) {
        drawRows.push({
          kind: 'subtotal',
          label: `${getName(b1)} & ${getName(b2)}`,
          net: b1.they_owe + b2.they_owe,
        });
      }
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
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';

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

  function drawCentered(text: string, iy: number) {
    const w = ctx.measureText(text).width;
    ctx.textAlign = 'left';
    ctx.fillText(text, (W - w) / 2, iy);
  }

  ctx.fillStyle = '#1a1a14';
  ctx.font = `bold 16px ${MONO}`;
  drawCentered((stripEmojis(name) || 'TRIP').toUpperCase(), HEADER_H / 2 + 6);

  y = HEADER_H;
  drawDivider();
  y += DIVPAD;

  drawRows.forEach((row, i) => {
    if (row.kind === 'person') {
      const label = row.name.length > 13 ? row.name.slice(0, 12) + '…' : row.name;
      ctx.fillStyle = '#1a1a14';
      ctx.font = `12px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.fillText(label, PAD, y);
      ctx.textAlign = 'right';
      ctx.fillText(formatMoney(row.net), W - PAD, y);
      y += NAME_LS;
    } else {
      const label = row.label.length > 15 ? row.label.slice(0, 14) + '…' : row.label;
      ctx.fillStyle = '#6b7280';
      ctx.font = `600 12px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.fillText(label, PAD, y);
      ctx.textAlign = 'right';
      ctx.fillText(formatMoney(row.net), W - PAD, y);
      y += SUBTOTAL_LS;
    }
    if (i < drawRows.length - 1) {
      y += row.kind === 'subtotal' ? GROUP_SEP_H : PERSON_GAP;
    }
  });

  drawDivider();
  y += DIVPAD;

  const total = activeBalances.reduce((sum, b) => sum + b.they_owe, 0);
  ctx.fillStyle = '#1a1a14';
  ctx.font = `bold 12px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText('TOTAL', PAD, y);
  ctx.textAlign = 'right';
  ctx.fillText(formatMoney(total), W - PAD, y);
  y += NAME_LS;

  drawDivider();
  y += DIVPAD_SM;

  ctx.fillStyle = '#78786a';
  ctx.font = `9px ${MONO}`;
  drawCentered('SPLIT IT', y);

  const dataUrl = canvas.toDataURL('image/png');
  const byteStr = atob(dataUrl.split(',')[1]);
  const arr = new Uint8Array(byteStr.length);
  for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i);
  return { blob: new Blob([arr], { type: 'image/png' }), dataUrl };
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
  const [mySpend, setMySpend] = useState<number | null>(null);
  const [pairs, setPairs] = useState<GroupPair[]>([]);
  const mergedBalances = useMemo(() => mergeBalancesWithPairs(balances, pairs, members, me?.id), [balances, pairs, members, me]);
  const [pairingForMemberId, setPairingForMemberId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [balancesLoading, setBalancesLoading] = useState(true);
  const [receiptsLoading, setReceiptsLoading] = useState(true);
  const [shareDataUrl, setShareDataUrl] = useState<string | null>(null);

  // Bottom sheet state (same as Home)
  const [sheet, setSheet] = useState<BreakdownSheet | null>(null);
  const [settling, setSettling] = useState(false);
  const [settleError, setSettleError] = useState('');
  const [copyToast, setCopyToast] = useState('');
  const [zelleModal, setZelleModal] = useState<{ contact: string; name: string; amount: number } | null>(null);
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
    getGroupMySpend(groupId)
      .then(({ my_spend }) => setMySpend(my_spend))
      .catch(() => {});
    getGroupPairs(groupId)
      .then(({ pairs: p }) => setPairs(p))
      .catch(() => {});
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
    // Two-sided pair: peer_user_id is the synthetic pair.id (not in pair_member_ids)
    const isTwoSidedPair = b.pair_member_ids && !b.pair_member_ids.includes(b.peer_user_id);
    if (isTwoSidedPair) {
      const [uid1, uid2] = b.pair_member_ids!;
      setSheet({ balance: b, they_owe_me: [], i_owe_them: [], loading: true });
      try {
        const [d1, d2] = await Promise.all([
          breakdownCache.current[uid1] ?? getGroupBreakdown(groupId!, uid1),
          breakdownCache.current[uid2] ?? getGroupBreakdown(groupId!, uid2),
        ]);
        const tag = (rows: BreakdownRow[], uid: string) => rows.map((r) => ({ ...r, peer_user_id: uid }));
        const they_owe_me = [...tag(d1.they_owe_me, uid1), ...tag(d2.they_owe_me, uid2)].sort((x, y) => y.date.localeCompare(x.date));
        const i_owe_them = [...tag(d1.i_owe_them, uid1), ...tag(d2.i_owe_them, uid2)].sort((x, y) => y.date.localeCompare(x.date));
        setSheet({ balance: b, they_owe_me, i_owe_them, loading: false });
      } catch {
        setSheet((prev) => prev ? { ...prev, loading: false } : null);
      }
      return;
    }
    // Individual or one-sided pair — peer_user_id is always the real person's ID
    const uid = b.peer_user_id;
    const cached = breakdownCache.current[uid];
    if (cached) { setSheet({ balance: b, ...cached, loading: false }); return; }
    setSheet({ balance: b, they_owe_me: [], i_owe_them: [], loading: true });
    try {
      const data = await getGroupBreakdown(groupId!, uid);
      breakdownCache.current[uid] = data;
      setSheet({ balance: b, ...data, loading: false });
    } catch {
      setSheet((prev) => prev ? { ...prev, loading: false } : null);
    }
  }

  async function settleRow(row: BreakdownRow, direction: 'they_owe_me' | 'i_owe_them') {
    if (!me || !sheet) return;
    const peerUserId = row.peer_user_id ?? sheet.balance.peer_user_id;
    setSettleError('');
    try {
      if (direction === 'they_owe_me') {
        await settle({ receipt_id: row.receipt_id, to_user_id: me.id, from_user_id: peerUserId, amount: row.amount, payment_method: 'other' });
      } else {
        await settle({ receipt_id: row.receipt_id, to_user_id: peerUserId, amount: row.amount, payment_method: 'other' });
      }
      delete breakdownCache.current[peerUserId];
      setSheet((s) => {
        if (!s) return null;
        const notThisRow = (r: BreakdownRow) =>
          !(r.receipt_id === row.receipt_id && (r.peer_user_id ?? '') === (row.peer_user_id ?? ''));
        const updated = {
          ...s,
          they_owe_me: direction === 'they_owe_me' ? s.they_owe_me.filter(notThisRow) : s.they_owe_me,
          i_owe_them: direction === 'i_owe_them' ? s.i_owe_them.filter(notThisRow) : s.i_owe_them,
        };
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
        ...sheet.i_owe_them.map((r) => settle({ receipt_id: r.receipt_id, to_user_id: r.peer_user_id ?? peer_user_id, amount: r.amount, payment_method: method })),
        ...sheet.they_owe_me.map((r) => settle({ receipt_id: r.receipt_id, from_user_id: r.peer_user_id ?? peer_user_id, to_user_id: me.id, amount: r.amount, payment_method: method })),
      ]);
      if (sheet.balance.pair_member_ids) {
        sheet.balance.pair_member_ids.forEach((uid) => delete breakdownCache.current[uid]);
      } else {
        delete breakdownCache.current[peer_user_id];
      }
      setSheet(null);
      getGroupBalances(groupId!).then(({ balances: b }) => setBalances(b)).catch(() => {});
    } catch (e) {
      setSettleError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSettling(false);
    }
  }

  async function settleBalance(b: BalanceSummary, method: 'venmo' | 'zelle' | 'cash' | 'other') {
    if (!me || !groupId) return;
    try {
      const isTwoSidedPair = b.pair_member_ids && !b.pair_member_ids.includes(b.peer_user_id);
      if (isTwoSidedPair) {
        const [uid1, uid2] = b.pair_member_ids!;
        const [d1, d2] = await Promise.all([
          breakdownCache.current[uid1] ?? getGroupBreakdown(groupId, uid1),
          breakdownCache.current[uid2] ?? getGroupBreakdown(groupId, uid2),
        ]);
        await Promise.all([
          ...d1.i_owe_them.map((r) => settle({ receipt_id: r.receipt_id, to_user_id: uid1, amount: r.amount, payment_method: method })),
          ...d1.they_owe_me.map((r) => settle({ receipt_id: r.receipt_id, from_user_id: uid1, to_user_id: me.id, amount: r.amount, payment_method: method })),
          ...d2.i_owe_them.map((r) => settle({ receipt_id: r.receipt_id, to_user_id: uid2, amount: r.amount, payment_method: method })),
          ...d2.they_owe_me.map((r) => settle({ receipt_id: r.receipt_id, from_user_id: uid2, to_user_id: me.id, amount: r.amount, payment_method: method })),
        ]);
        delete breakdownCache.current[uid1];
        delete breakdownCache.current[uid2];
      } else {
        // Individual or one-sided pair — always use peer_user_id
        const uid = b.peer_user_id;
        const data = breakdownCache.current[uid] ?? await getGroupBreakdown(groupId, uid);
        await Promise.all([
          ...data.i_owe_them.map((r) => settle({ receipt_id: r.receipt_id, to_user_id: uid, amount: r.amount, payment_method: method })),
          ...data.they_owe_me.map((r) => settle({ receipt_id: r.receipt_id, from_user_id: uid, to_user_id: me.id, amount: r.amount, payment_method: method })),
        ]);
        delete breakdownCache.current[uid];
      }
      getGroupBalances(groupId).then(({ balances: fresh }) => setBalances(fresh)).catch(() => {});
    } catch {}
  }

  // Prefetch breakdowns in background once balances are known
  useEffect(() => {
    if (balancesLoading || !groupId) return;
    for (const b of balances) {
      if (breakdownCache.current[b.peer_user_id]) continue;
      getGroupBreakdown(groupId, b.peer_user_id)
        .then((data) => { breakdownCache.current[b.peer_user_id] = data; })
        .catch(() => {});
    }
  }, [balances, balancesLoading, groupId]);

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
    setPairingForMemberId(null);
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
  const getMemberName = (uid: string) => {
    const m = members.find((mm) => mm.user_id === uid);
    return m ? (m.user?.display_name ?? m.user?.email?.split('@')[0] ?? '?') : '?';
  };

  function handleGroupShare() {
    const { blob, dataUrl } = generateGroupShareImage(groupName, balances, pairs, getMemberName);
    const file = new File([blob], 'split.png', { type: 'image/png' });
    if (navigator.share) {
      navigator.share({ files: [file], title: `Split It: ${stripEmojis(groupName)}` })
        .catch((err) => { if (err.name !== 'AbortError') setShareDataUrl(dataUrl); });
    } else {
      setShareDataUrl(dataUrl);
    }
  }

  const totalTheyOwe = balances.reduce((sum, b) => sum + b.they_owe, 0);
  const totalIOwe = balances.reduce((sum, b) => sum + b.you_owe, 0);
  const net = totalTheyOwe - totalIOwe;

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 text-2xl leading-none p-2 -ml-1">‹</button>
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
              {mySpend === null
                ? <Skeleton className="h-7 w-24 mt-1" />
                : <p className="text-2xl font-bold text-gray-900">{formatMoney(mySpend)}</p>}
              <p className="text-xs text-gray-400 mt-0.5">your share of group</p>
            </div>
          </div>
        </div>

        {/* Balances */}
        <section>
          {balancesLoading ? (
            <div className="space-y-2"><Skeleton className="h-4 w-24 mb-3" /><Skeleton className="h-16 w-full" /></div>
          ) : mergedBalances.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3 px-1">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Balances</h2>
                <button onClick={handleGroupShare} className="flex items-center gap-1 text-xs font-medium text-brand-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share
                </button>
              </div>
              <div className="space-y-2">
                {mergedBalances.map((b) => (
                  <SwipeRow
                    key={b.peer_user_id}
                    className="overflow-hidden rounded-2xl"
                    actions={[
                      { label: b.they_owe > 0 ? 'Received' : 'Paid', bgColor: '#22c55e', icon: <span className="w-5 h-5 flex items-center justify-center text-lg leading-none">✓</span>, onClick: () => settleBalance(b, 'other') },
                      ...(b.peer_venmo_handle ? [{ label: b.they_owe > 0 ? 'Request' : 'Send', bgColor: '#3d95ce', icon: <VenmoIcon />, onClick: () => { window.location.href = `venmo://paycharge?txn=${b.they_owe > 0 ? 'charge' : 'pay'}&recipients=${encodeURIComponent(b.peer_venmo_handle!)}&amount=${(b.they_owe || b.you_owe).toFixed(2)}&note=${encodeURIComponent('Split It')}`; } }] : []),
                      ...(b.peer_zelle_contact ? [{ label: 'Zelle', bgColor: '#6d1ed4', icon: <ZelleIcon />, onClick: () => setZelleModal({ contact: b.peer_zelle_contact!, name: peerName(b), amount: b.they_owe || b.you_owe }) }] : []),
                    ]}
                  >
                    <button
                      onClick={() => openBreakdown(b)}
                      className="card w-full flex items-center justify-between text-left active:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {b.pair_member_ids ? (
                          <PairAvatar
                            name1={(b.peer_display_name ?? '?').split(' & ')[0]}
                            name2={(b.peer_display_name ?? '?').split(' & ')[1] ?? '?'}
                          />
                        ) : (
                          <Avatar name={peerName(b)} />
                        )}
                        <div>
                          <p className="font-semibold text-base">{peerName(b)}</p>
                          <p className="text-xs text-gray-400">{b.they_owe > 0 ? (b.pair_member_ids ? 'owe you' : 'owes you') : 'you owe'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          {b.they_owe > 0
                            ? <p className="font-semibold text-green-600">+{formatMoney(b.they_owe)}</p>
                            : <p className="font-semibold text-red-500">-{formatMoney(b.you_owe)}</p>}
                        </div>
                        <span className="text-gray-300 text-sm">›</span>
                      </div>
                    </button>
                  </SwipeRow>
                ))}
              </div>
            </>
          )}
          {!balancesLoading && mergedBalances.length === 0 && (
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
                  <div className="text-right">
                    <p className="font-semibold text-sm">{r.total != null ? formatMoney(r.total) : '—'}</p>
                    <p className="text-xs text-gray-400">Paid by {r.owner_id === me?.id ? 'Me' : (r.owner_name ?? 'them')}</p>
                  </div>
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
            <div className="select-none">
              <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 bg-gray-200 rounded-full" /></div>
              <div className="px-6 py-3 border-b border-gray-100">
                <h3 className="font-bold text-base">Members</h3>
              </div>
            </div>

            {/* Member list */}
            <div ref={membersScrollRef} className="overflow-y-auto flex-1 px-6 py-3 space-y-1">
              {pairingForMemberId && (
                <div className="flex items-center justify-between bg-brand-50 rounded-xl px-3 py-2 mb-1">
                  <p className="text-xs font-medium text-brand-700">Tap a member to pair with</p>
                  <button onClick={() => setPairingForMemberId(null)} className="text-xs text-brand-400 font-medium">Cancel</button>
                </div>
              )}
              {members.map((m) => {
                const memberPair = pairs.find((p) => p.user_id_1 === m.user_id || p.user_id_2 === m.user_id);
                const pairPartnerName = (() => {
                  if (!memberPair) return null;
                  const uid = memberPair.user_id_1 === m.user_id ? memberPair.user_id_2 : memberPair.user_id_1;
                  const pm = members.find((mm) => mm.user_id === uid);
                  return pm ? (pm.user?.display_name ?? pm.user?.email?.split('@')[0] ?? '?') : null;
                })();
                const name = m.user?.display_name ?? m.user?.email?.split('@')[0] ?? '?';
                const isMe = m.user_id === me?.id;
                const isPairingMode = pairingForMemberId !== null;
                const isThisThePairer = m.user_id === pairingForMemberId;
                const isEligiblePartner = isPairingMode && !isThisThePairer && !memberPair;
                return (
                  <div key={m.user_id} className={`flex items-center gap-3 py-2.5 ${isThisThePairer ? 'opacity-50' : ''}`}>
                    <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-sm font-semibold text-gray-600 flex-shrink-0">
                      {name[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{name}{isMe ? ' (you)' : ''}</p>
                      {memberPair && pairPartnerName
                        ? <p className="text-xs text-gray-400">Paired with {pairPartnerName}</p>
                        : isThisThePairer
                          ? <p className="text-xs text-brand-500">Select a partner below</p>
                          : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {isEligiblePartner ? (
                        <button
                          onClick={async () => {
                            if (!groupId) return;
                            const { pair } = await addGroupPair(groupId, pairingForMemberId!, m.user_id);
                            setPairs((prev) => [...prev, pair]);
                            setPairingForMemberId(null);
                          }}
                          className="text-xs font-semibold text-white bg-brand-500 px-3 py-1.5 rounded-lg active:opacity-80"
                        >
                          Pair
                        </button>
                      ) : memberPair ? (
                        <button
                          onClick={async () => {
                            if (!groupId) return;
                            await removeGroupPair(groupId, memberPair.id);
                            setPairs((prev) => prev.filter((p) => p.id !== memberPair.id));
                          }}
                          className="text-xs text-red-400 px-2 py-1 rounded-lg active:bg-red-50"
                        >
                          Unpair
                        </button>
                      ) : !isPairingMode ? (
                        <button
                          onClick={() => setPairingForMemberId(m.user_id)}
                          className="text-xs text-gray-500 px-2 py-1 rounded-lg bg-gray-100 active:bg-gray-200"
                        >
                          Pair
                        </button>
                      ) : null}
                      {m.user_id !== me?.id && !isPairingMode && (
                        <button
                          onClick={() => handleRemoveMember(m.user_id)}
                          disabled={removingMember === m.user_id}
                          className="text-xs text-red-400 px-2 py-1 rounded-lg active:bg-red-50 disabled:opacity-40"
                        >
                          {removingMember === m.user_id ? '…' : 'Remove'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
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
                        {sheet.they_owe_me.map((row) => {
                          const rowB = row.peer_user_id ? balances.find((b) => b.peer_user_id === row.peer_user_id) : null;
                          const rowVenmo = rowB?.peer_venmo_handle ?? sheet.balance.peer_venmo_handle;
                          const rowZelle = rowB?.peer_zelle_contact ?? sheet.balance.peer_zelle_contact;
                          const rowName = rowB ? (rowB.peer_display_name ?? rowB.peer_email.split('@')[0]) : peerName(sheet.balance);
                          return (
                            <SwipeRow key={`${row.receipt_id}-${row.peer_user_id ?? ''}`} actions={[
                              { label: 'Received', bgColor: '#22c55e', icon: <span className="w-5 h-5 flex items-center justify-center text-lg leading-none">✓</span>, onClick: () => settleRow(row, 'they_owe_me') },
                              ...(rowVenmo ? [{ label: 'Request', bgColor: '#3d95ce', icon: <VenmoIcon />, onClick: () => { window.location.href = `venmo://paycharge?txn=charge&recipients=${encodeURIComponent(rowVenmo)}&amount=${row.amount.toFixed(2)}&note=${encodeURIComponent('Split It')}`; } }] : []),
                              ...(rowZelle ? [{ label: 'Zelle', bgColor: '#6d1ed4', icon: <ZelleIcon />, onClick: () => setZelleModal({ contact: rowZelle, name: rowName, amount: row.amount }) }] : []),
                            ]}>
                              <div className="flex items-center justify-between py-3 border-b border-gray-50">
                                <Link to={`/receipts/${row.receipt_id}`} onClick={() => setSheet(null)} className="flex-1 min-w-0">
                                  <p className="text-sm font-medium">{row.restaurant_name ?? 'Receipt'}</p>
                                  <p className="text-xs text-gray-400">{formatDate(row.date)}</p>
                                  {sheet.balance.pair_member_ids && <p className="text-xs font-medium text-gray-500">{getMemberName(row.peer_user_id ?? sheet.balance.peer_user_id)}</p>}
                                </Link>
                                <button onClick={() => { setCopyToast(`$${row.amount.toFixed(2)} copied`); setTimeout(() => setCopyToast(''), 1500); navigator.clipboard?.writeText(row.amount.toFixed(2)).catch(() => {}); }} className="font-semibold text-sm text-green-600 ml-2 flex-shrink-0 active:opacity-60">+{formatMoney(row.amount)}</button>
                              </div>
                            </SwipeRow>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {sheet.i_owe_them.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">You owe {peerName(sheet.balance)}</p>
                      <div className="space-y-2">
                        {sheet.i_owe_them.map((row) => {
                          const rowB = row.peer_user_id ? balances.find((b) => b.peer_user_id === row.peer_user_id) : null;
                          const rowVenmo = rowB?.peer_venmo_handle ?? sheet.balance.peer_venmo_handle;
                          const rowZelle = rowB?.peer_zelle_contact ?? sheet.balance.peer_zelle_contact;
                          const rowName = rowB ? (rowB.peer_display_name ?? rowB.peer_email.split('@')[0]) : peerName(sheet.balance);
                          return (
                            <SwipeRow key={`${row.receipt_id}-${row.peer_user_id ?? ''}`} actions={[
                              { label: 'Paid', bgColor: '#22c55e', icon: <span className="w-5 h-5 flex items-center justify-center text-lg leading-none">✓</span>, onClick: () => settleRow(row, 'i_owe_them') },
                              ...(rowVenmo ? [{ label: 'Send', bgColor: '#3d95ce', icon: <VenmoIcon />, onClick: () => { window.location.href = `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(rowVenmo)}&amount=${row.amount.toFixed(2)}&note=${encodeURIComponent('Split It')}`; settleRow(row, 'i_owe_them'); } }] : []),
                              ...(rowZelle ? [{ label: 'Zelle', bgColor: '#6d1ed4', icon: <ZelleIcon />, onClick: () => setZelleModal({ contact: rowZelle, name: rowName, amount: row.amount }) }] : []),
                            ]}>
                              <div className="flex items-center justify-between py-3 border-b border-gray-50">
                                <Link to={`/receipts/${row.receipt_id}`} onClick={() => setSheet(null)} className="flex-1 min-w-0">
                                  <p className="text-sm font-medium">{row.restaurant_name ?? 'Receipt'}</p>
                                  <p className="text-xs text-gray-400">{formatDate(row.date)}</p>
                                  {sheet.balance.pair_member_ids && <p className="text-xs font-medium text-gray-500">{getMemberName(row.peer_user_id ?? sheet.balance.peer_user_id)}</p>}
                                </Link>
                                <button onClick={() => { setCopyToast(`$${row.amount.toFixed(2)} copied`); setTimeout(() => setCopyToast(''), 1500); navigator.clipboard?.writeText(row.amount.toFixed(2)).catch(() => {}); }} className="font-semibold text-sm text-red-500 ml-2 flex-shrink-0 active:opacity-60">-{formatMoney(row.amount)}</button>
                              </div>
                            </SwipeRow>
                          );
                        })}
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
                {(sheet.balance.peer_venmo_handle || sheet.balance.peer_zelle_contact) && (
                  <div className="flex gap-3">
                    {sheet.balance.peer_venmo_handle && (
                      <a
                        href={`venmo://paycharge?txn=${sheet.balance.you_owe > 0 ? 'pay' : 'charge'}&recipients=${encodeURIComponent(sheet.balance.peer_venmo_handle)}&amount=${(sheet.balance.you_owe || sheet.balance.they_owe).toFixed(2)}&note=${encodeURIComponent('Split It')}`}
                        onClick={sheet.balance.you_owe > 0 ? () => settleAll('venmo') : undefined}
                        className="flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-1 font-semibold text-sm text-white active:opacity-80"
                        style={{ backgroundColor: '#3d95ce' }}
                      >
                        {sheet.balance.you_owe > 0 ? 'Send via' : 'Request via'}
                        <VenmoIcon />
                      </a>
                    )}
                    {sheet.balance.peer_zelle_contact && (
                      <button
                        onClick={() => setZelleModal({ contact: sheet.balance.peer_zelle_contact!, name: peerName(sheet.balance), amount: sheet.balance.you_owe || sheet.balance.they_owe })}
                        className="flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-1 font-semibold text-sm text-white active:opacity-80"
                        style={{ backgroundColor: '#6d1ed4' }}
                      >
                        {sheet.balance.you_owe > 0 ? 'Send via' : 'Request via'}
                        <ZelleIcon />
                      </button>
                    )}
                  </div>
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

      {zelleModal && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-6" onClick={() => setZelleModal(null)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-xs shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: '#6d1ed4' }}>
                <ZelleIcon className="w-8 h-8" />
              </div>
            </div>
            <p className="text-center text-sm text-gray-500 mb-0.5">Send to</p>
            <p className="text-center font-bold text-gray-900 text-lg mb-5">{zelleModal.name}</p>
            <ZelleFields contact={zelleModal.contact} amount={zelleModal.amount} onCopy={(text) => { navigator.clipboard?.writeText(text).catch(() => {}); setCopyToast('Copied!'); setTimeout(() => setCopyToast(''), 1500); }} />
            <button onClick={() => setZelleModal(null)} className="w-full py-2 text-sm text-gray-400">Close</button>
          </div>
        </div>
      )}

      {copyToast && (
        <div className="fixed inset-0 flex items-center justify-center z-[999] pointer-events-none">
          <div className="bg-gray-900 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-2xl">
            {copyToast}
          </div>
        </div>
      )}

      {shareDataUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center gap-4 px-4" onClick={() => setShareDataUrl(null)}>
          <p className="text-white text-sm font-medium">Press and hold to share</p>
          <img src={shareDataUrl} alt="Trip split" className="w-52 rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
          <button className="text-white/60 text-sm mt-2" onClick={() => setShareDataUrl(null)}>Close</button>
        </div>
      )}
    </div>
  );
}
