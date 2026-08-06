import React, { useRef, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ocr, resolvePersonInput, searchUsers, getMe, createReceipt as apiCreateReceipt, updateReceiptFull, listGroups } from '../lib/api';
import type { GroupSummary } from '@split-it/types';
import { useContactsStore } from '../store/contacts';
import type { OcrLineItem, User, ReceiptWithDetails } from '@split-it/types';

function fmtPrice(n: number): string {
  return (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const DEL_SNAP = 80;
const DEL_THRESHOLD = 40;

function DeleteSwipeRow({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  const slideRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const currentTx = useRef(-DEL_SNAP);
  const gestureBase = useRef(-DEL_SNAP);
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
      applyTransform(Math.min(Math.max(-DEL_SNAP, gestureBase.current + dx), 20), false);
    }
    function onEnd() {
      if (!isDragging.current) return;
      isDragging.current = false;
      const open = currentTx.current > -(DEL_SNAP - DEL_THRESHOLD);
      applyTransform(open ? 0 : -DEL_SNAP, true);
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
    <div className="overflow-hidden rounded-2xl shadow-sm border border-gray-100">
      <div
        ref={slideRef}
        className="flex"
        style={{ width: `calc(100% + ${DEL_SNAP}px)`, transform: `translateX(-${DEL_SNAP}px)` }}
      >
        <div className="flex-shrink-0 flex items-center justify-center bg-red-500" style={{ width: DEL_SNAP }}>
          <button
            onClick={() => { applyTransform(-DEL_SNAP, true); onDelete(); }}
            className="w-full h-full text-white font-semibold text-xs flex flex-col items-center justify-center gap-0.5"
          >
            <span className="text-lg leading-none">×</span>
            <span>Remove</span>
          </button>
        </div>
        <div ref={contentRef} className="flex-1 min-w-0 bg-white p-4">
          {children}
        </div>
      </div>
    </div>
  );
}

function evalExpr(raw: string): number {
  const s = raw.replace(/,/g, '').trim();
  if (/^[\d.+\-*/() ]+$/.test(s)) {
    try {
      // eslint-disable-next-line no-new-func
      const result = new Function(`return (${s})`)();
      if (typeof result === 'number' && isFinite(result) && result >= 0) return +result.toFixed(2);
    } catch { /* fall through */ }
  }
  return parseFloat(s) || 0;
}

function PriceInput({ value, className, onChange }: { value: number; className?: string; onChange: (v: number) => void }) {
  const [text, setText] = useState(fmtPrice(value ?? 0));
  useEffect(() => { setText(fmtPrice(value ?? 0)); }, [value]);
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">$</span>
      <input
        className={`${className} pl-6`}
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = evalExpr(text);
          onChange(parsed);
          setText(fmtPrice(parsed));
        }}
      />
    </div>
  );
}

type EditableItem = OcrLineItem & { id: string; assignments: { user: User; fraction: number }[] };

function newId() { return Math.random().toString(36).slice(2); }

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function NewReceipt() {
  const navigate = useNavigate();
  const location = useLocation();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'capture' | 'edit' | 'assign' | 'summary'>('capture');
  const [editReceiptId, setEditReceiptId] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const [meta, setMeta] = useState<{ restaurant_name: string | null; date: string | null; subtotal: number | null; tax: number | null; tip: number | null; total: number | null }>({
    restaurant_name: null, date: null, subtotal: null, tax: null, tip: null, total: null,
  });
  const [items, setItems] = useState<EditableItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  // For adding people
  const { add: addContact } = useContactsStore();
  const [emailInput, setEmailInput] = useState('');
  const [suggestions, setSuggestions] = useState<User[]>([]);
  const [people, setPeople] = useState<User[]>([]);
  const [emailLoading, setEmailLoading] = useState(false);
  const [me, setMe] = useState<User | null>(null);

  useEffect(() => {
    getMe().then(({ user }) => {
      setMe(user);
      const state = location.state as { editReceipt?: ReceiptWithDetails } | null;
      if (state?.editReceipt) {
        const allUsers = new Map<string, User>();
        allUsers.set(user.id, user);
        for (const li of state.editReceipt.line_items) {
          for (const a of li.assignments) {
            if (a.user && !allUsers.has(a.user.id)) allUsers.set(a.user.id, a.user as User);
          }
        }
        setPeople(Array.from(allUsers.values()));
      } else {
        setPeople([user]);
      }
    }).catch(() => {});
    listGroups().then(({ groups: g }) => setGroups(g)).catch(() => {});
  }, []);

  useEffect(() => {
    const state = location.state as { file?: File; manual?: boolean; editReceipt?: ReceiptWithDetails } | null;
    if (state?.file) {
      handleImageFile(state.file);
    } else if (state?.manual) {
      setMeta({ restaurant_name: null, date: new Date().toISOString().slice(0, 10), subtotal: null, tax: null, tip: null, total: null });
      setItems([{ id: newId(), description: '', quantity: 1, unit_price: 0, total_price: 0, assignments: [] }]);
      setStep('edit');
    } else if (state?.editReceipt) {
      const r = state.editReceipt;
      setEditReceiptId(r.id);
      setMeta({ restaurant_name: r.restaurant_name, date: r.date, subtotal: r.subtotal ?? null, tax: r.tax, tip: r.tip, total: r.total });
      setItems(r.line_items.map((li) => ({
        id: li.id,
        description: li.description,
        quantity: li.quantity,
        unit_price: li.unit_price,
        total_price: li.total_price,
        assignments: li.assignments
          .filter((a) => a.user)
          .map((a) => ({ user: a.user as User, fraction: a.fraction })),
      })));
      setSelectedGroupId(r.group_id ?? null);
      setStep('edit');
    }
  }, []);

  async function handleImageFile(file: File) {
    setOcrError('');
    setOcrLoading(true);
    try {
      const imageBase64 = await toBase64(file);
      const mimeType = (file.type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
      const result = await ocr({ imageBase64, mimeType });
      setMeta({ restaurant_name: result.restaurant_name, date: result.date ?? null, subtotal: result.subtotal ?? null, tax: result.tax, tip: result.tip, total: result.total });
      setItems((result.line_items ?? []).map((li) => ({
        ...li,
        unit_price: li.unit_price ?? 0,
        total_price: li.total_price ?? 0,
        quantity: li.quantity ?? 1,
        id: newId(),
        assignments: [],
      })));
      setStep('edit');
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'OCR failed');
    } finally {
      setOcrLoading(false);
    }
  }

  function updateItem(id: string, patch: Partial<EditableItem>) {
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function addItem() {
    setItems((prev) => [...prev, { id: newId(), description: '', quantity: 1, unit_price: 0, total_price: 0, assignments: [] }]);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  useEffect(() => {
    const val = emailInput.trim();
    if (val.length < 1) { setSuggestions([]); return; }
    const timer = setTimeout(() => {
      searchUsers(val)
        .then(({ users }) => setSuggestions(users.filter((u) => !people.find((p) => p.id === u.id))))
        .catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [emailInput, people]);

  function pickSuggestion(user: User) {
    if (!people.find((p) => p.id === user.id)) {
      setPeople((prev) => [...prev, user]);
      addContact(user);
    }
    setEmailInput('');
    setSuggestions([]);
  }

  async function addPerson() {
    const val = emailInput.trim();
    if (!val) return;
    setEmailLoading(true);
    setSuggestions([]);
    try {
      const user = await resolvePersonInput(val);
      if (!people.find((p) => p.id === user.id)) {
        setPeople((prev) => [...prev, user]);
        addContact(user);
      }
      setEmailInput('');
    } finally {
      setEmailLoading(false);
    }
  }

  function toggleAssignment(itemId: string, user: User) {
    setItems((prev) => prev.map((item) => {
      if (item.id !== itemId) return item;
      const exists = item.assignments.find((a) => a.user.id === user.id);
      const newAssignments = exists
        ? item.assignments.filter((a) => a.user.id !== user.id)
        : [...item.assignments, { user, fraction: 0 }];
      // Rebalance to equal fractions
      const n = newAssignments.length;
      return { ...item, assignments: newAssignments.map((a) => ({ ...a, fraction: n > 0 ? 1 / n : 0 })) };
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const computedSubtotal = items.reduce((s, i) => s + i.total_price, 0);
      const subtotal = meta.subtotal ?? computedSubtotal;
      const payload = {
        restaurant_name: meta.restaurant_name,
        date: meta.date ?? undefined,
        tax: meta.tax,
        tip: meta.tip,
        total: meta.total ?? subtotal + (meta.tax ?? 0) + (meta.tip ?? 0),
        subtotal,
        line_items: items.map((item, idx) => ({
          description: item.description,
          unit_price: item.unit_price,
          quantity: item.quantity,
          total_price: item.total_price,
          position: idx,
          assignments: item.assignments.map((a) => ({ user_id: a.user.id, fraction: a.fraction })),
        })),
        group_id: selectedGroupId ?? undefined,
      };
      if (editReceiptId) {
        await updateReceiptFull(editReceiptId, payload);
        navigate(`/receipts/${editReceiptId}`, { replace: true });
      } else {
        const { receipt } = await apiCreateReceipt(payload);
        navigate(`/receipts/${receipt.id}`, { replace: true });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-4 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-gray-500 text-sm">← Back</button>
        <h1 className="font-semibold">{editReceiptId ? 'Edit Receipt' : 'New Receipt'}</h1>
      </div>

      {/* Step: Capture */}
      {step === 'capture' && (
        <div className="px-6 pt-8 flex flex-col items-center gap-4">
          {ocrLoading ? (
            <div className="text-center pt-12">
              <div className="text-4xl mb-4">🔍</div>
              <p className="text-gray-600 font-medium">Reading receipt…</p>
              <p className="text-gray-400 text-sm mt-1">This takes a few seconds</p>
            </div>
          ) : (
            <>
              <button
                onClick={() => cameraRef.current?.click()}
                className="w-full h-36 border-2 border-dashed border-brand-300 rounded-2xl flex flex-col
                  items-center justify-center gap-2 text-brand-500 bg-brand-50 active:bg-brand-100 transition"
              >
                <span className="text-3xl">📷</span>
                <span className="font-medium">Take a photo</span>
              </button>
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) handleImageFile(e.target.files[0]); }}
              />
              <button
                onClick={() => libraryRef.current?.click()}
                className="btn-secondary"
              >
                Upload from library
              </button>
              <input
                ref={libraryRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) handleImageFile(e.target.files[0]); }}
              />
              <div className="flex items-center gap-3 w-full">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400 font-medium">or</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              <button
                onClick={() => {
                  setMeta({ restaurant_name: null, date: new Date().toISOString().slice(0, 10), subtotal: null, tax: null, tip: null, total: null });
                  setItems([{ id: newId(), description: '', quantity: 1, unit_price: 0, total_price: 0, assignments: [] }]);
                  setStep('edit');
                }}
                className="btn-secondary"
              >
                ✏️ Enter manually
              </button>
              {ocrError && <p className="text-red-500 text-sm text-center">{ocrError}</p>}
            </>
          )}
        </div>
      )}

      {/* Step: Edit line items */}
      {step === 'edit' && (
        <div className="px-4 pt-4 space-y-4">
          <div className="card space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Restaurant</label>
              <input
                className="input mt-1"
                value={meta.restaurant_name ?? ''}
                onChange={(e) => setMeta({ ...meta, restaurant_name: e.target.value || null })}
                placeholder="Restaurant name"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Date</label>
              <input
                className="input mt-1"
                style={{ width: '11rem', minWidth: 0 }}
                type="date"
                value={meta.date ?? ''}
                onChange={(e) => setMeta({ ...meta, date: e.target.value || null })}
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Subtotal</label>
                <PriceInput
                  className="input mt-1"
                  value={meta.subtotal ?? items.reduce((s, i) => s + i.total_price, 0)}
                  onChange={(v) => setMeta({ ...meta, subtotal: v || null })}
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Tax</label>
                <PriceInput
                  className="input mt-1"
                  value={meta.tax ?? 0}
                  onChange={(v) => setMeta({ ...meta, tax: v || null })}
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Tip</label>
                <PriceInput
                  className="input mt-1"
                  value={meta.tip ?? 0}
                  onChange={(v) => setMeta({ ...meta, tip: v || null })}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total</label>
              <PriceInput
                className="input mt-1"
                value={meta.total ?? 0}
                onChange={(v) => setMeta({ ...meta, total: v || null })}
              />
            </div>
          </div>

          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide px-1">Items</h2>

          {items.map((item) => (
            <DeleteSwipeRow key={item.id} onDelete={() => removeItem(item.id)}>
              <div className="space-y-2">
                <input
                  className="input w-full"
                  value={item.description}
                  onChange={(e) => updateItem(item.id, { description: e.target.value })}
                  placeholder="Item description"
                />
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Qty</label>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => {
                        const q = +e.target.value;
                        updateItem(item.id, { quantity: q, total_price: +(q * item.unit_price).toFixed(2) });
                      }}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Unit</label>
                    <PriceInput
                      className="input"
                      value={item.unit_price}
                      onChange={(up) => updateItem(item.id, { unit_price: up, total_price: +(item.quantity * up).toFixed(2) })}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total</label>
                    <PriceInput
                      className="input"
                      value={item.total_price}
                      onChange={(tp) => updateItem(item.id, { total_price: tp })}
                    />
                  </div>
                </div>
              </div>
            </DeleteSwipeRow>
          ))}

          <button onClick={addItem} className="btn-secondary">+ Add item</button>
          <button onClick={() => setStep('assign')} className="btn-primary">Next: Assign people →</button>
        </div>
      )}

      {/* Step: Assign people */}
      {step === 'assign' && (
        <div className="px-4 pt-4 space-y-4">
          <div className="card">
            <p className="text-sm font-medium text-gray-700 mb-2">Add people by email</p>
            <div className="relative">
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  type="text"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addPerson()}
                  placeholder="Name or email"
                />
                <button onClick={addPerson} disabled={emailLoading} className="px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                  {emailLoading ? '…' : 'Add'}
                </button>
              </div>
              {suggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-gray-100 z-10 overflow-hidden">
                  {suggestions.map((u) => (
                    <button
                      key={u.id}
                      onMouseDown={(e) => { e.preventDefault(); pickSuggestion(u); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-brand-50 transition-colors"
                    >
                      <p className="text-sm font-medium">{u.display_name ?? u.email}</p>
                      {u.display_name && <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{u.email}</p>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {people.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {people.map((p) => {
                  const isMe = me?.id === p.id;
                  return (
                    <span key={p.id} className="bg-brand-100 text-brand-700 text-xs font-medium px-3 py-1 rounded-full flex items-center gap-1">
                      {isMe ? 'Me' : (p.display_name ?? p.email)}
                      {!isMe && (
                        <button onClick={() => setPeople((prev) => prev.filter((u) => u.id !== p.id))} className="text-brand-400 ml-1">×</button>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {groups.length > 0 && (
            <div className="card space-y-2">
              <p className="text-sm font-medium text-gray-700">Add to group</p>
              <select
                value={selectedGroupId ?? ''}
                onChange={(e) => {
                  const gId = e.target.value || null;
                  setSelectedGroupId(gId);
                  if (gId) {
                    const grp = groups.find((g) => g.id === gId);
                    if (grp) {
                      setPeople((prev) => {
                        const existingIds = new Set(prev.map((p) => p.id));
                        const toAdd = grp.members
                          .filter((m) => !existingIds.has(m.id))
                          .map((m) => ({ id: m.id, email: m.email, display_name: m.display_name, is_registered: true } as User));
                        return [...prev, ...toAdd];
                      });
                    }
                  }
                }}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
              >
                <option value="">None</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              {selectedGroupId && (
                <p className="text-xs text-gray-400">Group members added to people list above.</p>
              )}
            </div>
          )}

          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide px-1">Tap to assign</h2>

          {items.map((item) => (
            <div key={item.id} className="card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{item.description || '(no name)'}</span>
                <span className="text-sm text-gray-500">${item.total_price.toFixed(2)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {people.length > 1 && (() => {
                  const allAssigned = people.every((p) => item.assignments.some((a) => a.user.id === p.id));
                  return (
                    <button
                      onClick={() => {
                        if (allAssigned) {
                          setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, assignments: [] } : i));
                        } else {
                          const n = people.length;
                          setItems((prev) => prev.map((i) => i.id === item.id
                            ? { ...i, assignments: people.map((p) => ({ user: p, fraction: 1 / n })) }
                            : i
                          ));
                        }
                      }}
                      className={`text-xs px-3 py-1.5 rounded-full font-medium border transition ${
                        allAssigned
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'bg-white text-gray-600 border-gray-200'
                      }`}
                    >
                      All
                    </button>
                  );
                })()}
                {people.map((p) => {
                  const assigned = item.assignments.some((a) => a.user.id === p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggleAssignment(item.id, p)}
                      className={`text-xs px-3 py-1.5 rounded-full font-medium border transition ${
                        assigned
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'bg-white text-gray-600 border-gray-200'
                      }`}
                    >
                      {me?.id === p.id ? 'Me' : (p.display_name ?? p.email.split('@')[0])}
                    </button>
                  );
                })}
                {people.length === 0 && <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Add people above first</p>}
              </div>
              {item.assignments.length > 1 && (
                <p className="text-xs text-gray-400 mt-2">Split equally between {item.assignments.length}</p>
              )}
            </div>
          ))}

          {(() => {
            const unassigned = people.filter((p) => !items.some((item) => item.assignments.some((a) => a.user.id === p.id)));
            return (
              <>
                {unassigned.length > 0 && <p className="text-xs text-amber-600 text-center">Not assigned: {unassigned.map((p) => me?.id === p.id ? 'Me' : (p.display_name ?? p.email.split('@')[0])).join(', ')}</p>}
                <button onClick={() => setStep('edit')} className="btn-secondary">← Back</button>
                <button onClick={save} disabled={saving || unassigned.length > 0} className="btn-primary">{saving ? 'Saving…' : 'Save receipt'}</button>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
