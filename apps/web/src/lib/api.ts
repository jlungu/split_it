import { supabase } from './supabase';
import type {
  OcrRequest,
  OcrResponse,
  User,
  Receipt,
  ReceiptWithDetails,
  SplitCalculation,
  BalanceSummary,
  BreakdownRow,
  Settlement,
  Group,
  GroupMember,
  GroupSummary,
} from '@split-it/types';

export type { BreakdownRow, Group, GroupMember, GroupSummary };

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

export const getMe = () => request<{ user: User }>('/api/users/me');

export const updateMe = (patch: Pick<User, 'display_name' | 'venmo_handle' | 'zelle_contact'>) =>
  request<{ user: User }>('/api/users/me', { method: 'PUT', body: JSON.stringify(patch) });

// Receipts
export const listReceipts = () => request<{ receipts: Receipt[] }>('/api/receipts');

export const getReceipt = (id: string) =>
  request<{ receipt: ReceiptWithDetails }>(`/api/receipts/${id}`);

export const createReceipt = (body: object) =>
  request<{ receipt: Receipt }>('/api/receipts', { method: 'POST', body: JSON.stringify(body) });

export const updateReceipt = (id: string, patch: Partial<Receipt>) =>
  request<{ receipt: Receipt }>(`/api/receipts/${id}`, { method: 'PUT', body: JSON.stringify(patch) });

export const deleteReceipt = (id: string) =>
  request<{ ok: boolean }>(`/api/receipts/${id}`, { method: 'DELETE' });

// Splits
export const calculateSplit = (receiptId: string) =>
  request<{ splits: SplitCalculation[] }>(`/api/splits/calculate/${receiptId}`);

export const settle = (body: { receipt_id: string; to_user_id: string; from_user_id?: string; amount: number; payment_method: Settlement['payment_method'] }) =>
  request<{ settlement: Settlement }>('/api/splits/settle', { method: 'POST', body: JSON.stringify(body) });

export const getBalances = () =>
  request<{ balances: BalanceSummary[] }>('/api/splits/balances');

export const getBalanceBreakdown = (peerId: string) =>
  request<{ they_owe_me: BreakdownRow[]; i_owe_them: BreakdownRow[] }>(
    `/api/splits/breakdown/${peerId}`
  );

// Groups
export const listGroups = () =>
  request<{ groups: GroupSummary[] }>('/api/groups');

export const createGroup = (name: string) =>
  request<{ group: Group }>('/api/groups', { method: 'POST', body: JSON.stringify({ name }) });

export const getGroup = (id: string) =>
  request<{ group: Group; members: GroupMember[] }>(`/api/groups/${id}`);

export const renameGroup = (groupId: string, name: string) =>
  request<{ group: Group }>(`/api/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify({ name }) });

export const addGroupMember = (groupId: string, userId: string) =>
  request<void>(`/api/groups/${groupId}/members`, { method: 'POST', body: JSON.stringify({ user_id: userId }) });

export const removeGroupMember = (groupId: string, userId: string) =>
  request<void>(`/api/groups/${groupId}/members/${userId}`, { method: 'DELETE' });

export const listGroupReceipts = (groupId: string) =>
  request<{ receipts: Receipt[] }>(`/api/groups/${groupId}/receipts`);

export const getGroupBalances = (groupId: string) =>
  request<{ balances: BalanceSummary[] }>(`/api/groups/${groupId}/balances`);

export const getGroupBreakdown = (groupId: string, peerId: string) =>
  request<{ they_owe_me: BreakdownRow[]; i_owe_them: BreakdownRow[] }>(
    `/api/groups/${groupId}/breakdown/${peerId}`
  );

export const assignReceiptToGroup = (receiptId: string, groupId: string | null) =>
  request<{ receipt: Receipt }>(`/api/receipts/${receiptId}`, {
    method: 'PUT',
    body: JSON.stringify({ group_id: groupId }),
  });
