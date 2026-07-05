export interface User {
  id: string;
  email: string;
  display_name: string | null;
  venmo_handle: string | null;
  zelle_contact: string | null;
  is_registered: boolean;
  created_at?: string;
}

export interface Receipt {
  id: string;
  owner_id: string;
  image_url: string | null;
  restaurant_name: string | null;
  date: string;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
  created_at?: string;
}

export interface LineItem {
  id: string;
  receipt_id: string;
  description: string;
  unit_price: number;
  quantity: number;
  total_price: number;
  position: number;
}

export interface Assignment {
  id: string;
  line_item_id: string;
  user_id: string;
  fraction: number;
  computed_amount: number;
  user?: Pick<User, 'id' | 'email' | 'display_name' | 'venmo_handle' | 'zelle_contact'> | null;
}

export interface Settlement {
  id: string;
  receipt_id: string;
  from_user_id: string;
  to_user_id: string;
  amount: number;
  paid_at: string | null;
  payment_method: 'venmo' | 'zelle' | 'cash' | 'other' | null;
}

// API request/response types
export interface OcrRequest {
  imageBase64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}

export interface OcrLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

export interface OcrResponse {
  restaurant_name: string | null;
  date?: string | null;
  line_items: OcrLineItem[];
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
}

// Per-person split breakdown for a single receipt
export interface SplitCalculation {
  user_id: string;
  items_total: number;
  tax_tip_share: number;
  grand_total: number;
}

// Aggregate balance between the current user and one peer across all receipts
export interface BalanceSummary {
  peer_user_id: string;
  peer_email: string;
  peer_display_name: string | null;
  peer_venmo_handle: string | null;
  peer_zelle_contact: string | null;
  net_amount: number; // positive = they owe you, negative = you owe them
  you_owe: number;    // always >= 0
  they_owe: number;   // always >= 0
}

// Receipt with all child data for the detail screen
export interface LineItemWithAssignments extends LineItem {
  assignments: Assignment[];
}

export interface ReceiptWithDetails extends Receipt {
  line_items: LineItemWithAssignments[];
  owner?: Pick<User, 'id' | 'email' | 'display_name' | 'venmo_handle' | 'zelle_contact'> | null;
}
