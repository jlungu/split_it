import { supabase } from './supabase';
import { apiCache } from './cache';
import type {
  OcrRequest,
  OcrResponse,
  User,
  Receipt,
  ReceiptWithDetails,
  SplitCalculation,
  BalanceSummary,
  GroupPair,
  BreakdownRow,
  Settlement,
  Group,
  GroupMember,
  GroupSummary,
} from '@split-it/types';

export type { BreakdownRow, Group, GroupMember, GroupSummary, GroupPair };

async function authHeader(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const headers = { 'Content-Type': 'application/json', ...(await authHeader()), ...init?.headers };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 10_000);
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: controller.signal });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? res.statusText);
    return json as T;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error('Request timed out — is the API server running?');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// OCR
export const ocr = (body: OcrRequest) =>
  request<OcrResponse>('/api/ocr', { method: 'POST', body: JSON.stringify(body), timeoutMs: 60_000 });

// Users
export const searchUsers = (q: string) =>
  request<{ users: User[] }>(`/api/users/search?q=${encodeURIComponent(q)}`);

export const findOrCreateUser = (email: string) =>
  request<{ user: User }>('/api/users/find-or-create', { method: 'POST', body: JSON.stringify({ email }) });

export const createGuest = (display_name: string) =>
  request<{ user: User }>('/api/users/guest', { method: 'POST', body: JSON.stringify({ display_name }) });

export async function resolvePersonInput(val: string): Promise<User> {
  const v = val.trim();
  if (v.includes('@')) return (await findOrCreateUser(v)).user;
  return (await createGuest(v)).user;
}

export const getMe = () =>
  apiCache.fetch('me', () => request<{ user: User }>('/api/users/me'), 5 * 60_000);

export const updateMe = async (patch: Pick<User, 'display_name' | 'venmo_handle' | 'zelle_contact'>) => {
  const result = await request<{ user: User }>('/api/users/me', { method: 'PUT', body: JSON.stringify(patch) });
  apiCache.invalidate('me');
  return result;
};

// Receipts
export const listReceipts = () =>
  apiCache.fetch('receipts', () => request<{ receipts: Receipt[] }>('/api/receipts'));

export const getReceipt = (id: string) =>
  apiCache.fetch(`receipt:${id}`, () => request<{ receipt: ReceiptWithDetails }>(`/api/receipts/${id}`));

export const createReceipt = async (body: object) => {
  const result = await request<{ receipt: Receipt }>('/api/receipts', { method: 'POST', body: JSON.stringify(body) });
  apiCache.invalidate('receipts', 'balances', 'groups');
  apiCache.invalidatePrefix('group:');
  return result;
};

export const updateReceipt = async (id: string, patch: Partial<Receipt>) => {
  const result = await request<{ receipt: Receipt }>(`/api/receipts/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
  apiCache.invalidate('receipts', `receipt:${id}`, `split:${id}`, 'groups');
  apiCache.invalidatePrefix('group:');
  return result;
};

export const deleteReceipt = async (id: string) => {
  const result = await request<{ ok: boolean }>(`/api/receipts/${id}`, { method: 'DELETE' });
  apiCache.invalidate('receipts', `receipt:${id}`, `split:${id}`, 'balances', 'groups');
  apiCache.invalidatePrefix('group:');
  return result;
};

// Splits
export const calculateSplit = (receiptId: string) =>
  apiCache.fetch(`split:${receiptId}`, () => request<{ splits: SplitCalculation[] }>(`/api/splits/calculate/${receiptId}`));

export const settle = async (body: { receipt_id: string; to_user_id: string; from_user_id?: string; amount: number; payment_method: Settlement['payment_method'] }) => {
  const result = await request<{ settlement: Settlement }>('/api/splits/settle', { method: 'POST', body: JSON.stringify(body) });
  apiCache.invalidate('balances', 'receipts');
  apiCache.invalidatePrefix('breakdown:');
  apiCache.invalidatePrefix('group:');
  return result;
};

export const getBalances = () =>
  apiCache.fetch('balances', () => request<{ balances: BalanceSummary[] }>('/api/splits/balances'));

export const getBalanceBreakdown = (peerId: string) =>
  apiCache.fetch(`breakdown:${peerId}`, () =>
    request<{ they_owe_me: BreakdownRow[]; i_owe_them: BreakdownRow[] }>(`/api/splits/breakdown/${peerId}`)
  );

// Groups
export const listGroups = () =>
  apiCache.fetch('groups', () => request<{ groups: GroupSummary[] }>('/api/groups'));

export const createGroup = async (name: string) => {
  const result = await request<{ group: Group }>('/api/groups', { method: 'POST', body: JSON.stringify({ name }) });
  apiCache.invalidate('groups');
  return result;
};

export const getGroup = (id: string) =>
  apiCache.fetch(`group:${id}`, () => request<{ group: Group; members: GroupMember[] }>(`/api/groups/${id}`));

export const renameGroup = async (groupId: string, name: string) => {
  const result = await request<{ group: Group }>(`/api/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify({ name }) });
  apiCache.invalidate('groups', `group:${groupId}`);
  return result;
};

export const addGroupMember = async (groupId: string, userId: string) => {
  const result = await request<void>(`/api/groups/${groupId}/members`, { method: 'POST', body: JSON.stringify({ user_id: userId }) });
  apiCache.invalidate('groups', `group:${groupId}`);
  apiCache.invalidatePrefix(`group:${groupId}:`);
  return result;
};

export const removeGroupMember = async (groupId: string, userId: string) => {
  const result = await request<void>(`/api/groups/${groupId}/members/${userId}`, { method: 'DELETE' });
  apiCache.invalidate('groups', `group:${groupId}`);
  apiCache.invalidatePrefix(`group:${groupId}:`);
  return result;
};

export const listGroupReceipts = (groupId: string) =>
  apiCache.fetch(`group:${groupId}:receipts`, () => request<{ receipts: Receipt[] }>(`/api/groups/${groupId}/receipts`));

export const getGroupBalances = (groupId: string) =>
  apiCache.fetch(`group:${groupId}:balances`, () => request<{ balances: BalanceSummary[] }>(`/api/groups/${groupId}/balances`));

export const getGroupMySpend = (groupId: string) =>
  apiCache.fetch(`group:${groupId}:my-spend`, () =>
    request<{ my_spend: number }>(`/api/groups/${groupId}/my-spend`)
  );

export const getGroupBreakdown = (groupId: string, peerId: string) =>
  apiCache.fetch(`group:${groupId}:breakdown:${peerId}`, () =>
    request<{ they_owe_me: BreakdownRow[]; i_owe_them: BreakdownRow[] }>(`/api/groups/${groupId}/breakdown/${peerId}`)
  );

export const getGroupPairs = (groupId: string) =>
  apiCache.fetch(`group:${groupId}:pairs`, () =>
    request<{ pairs: GroupPair[] }>(`/api/groups/${groupId}/pairs`)
  );

export const addGroupPair = async (groupId: string, uid1: string, uid2: string) => {
  const result = await request<{ pair: GroupPair }>(`/api/groups/${groupId}/pairs`, {
    method: 'POST',
    body: JSON.stringify({ user_id_1: uid1, user_id_2: uid2 }),
  });
  apiCache.invalidate(`group:${groupId}:pairs`);
  return result;
};

export const removeGroupPair = async (groupId: string, pairId: string) => {
  const result = await request<{ ok: boolean }>(`/api/groups/${groupId}/pairs/${pairId}`, { method: 'DELETE' });
  apiCache.invalidate(`group:${groupId}:pairs`);
  return result;
};

export const assignReceiptToGroup = async (receiptId: string, groupId: string | null) => {
  const result = await request<{ receipt: Receipt }>(`/api/receipts/${receiptId}`, {
    method: 'PUT',
    body: JSON.stringify({ group_id: groupId }),
  });
  apiCache.invalidate('receipts', `receipt:${receiptId}`, 'groups');
  apiCache.invalidatePrefix('group:');
  return result;
};
