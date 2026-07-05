-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ============================================================
-- USERS
-- Mirrors auth.users. is_registered=false = placeholder created
-- when someone tags an email that hasn't signed up yet.
-- ============================================================
create table if not exists public.users (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique,
  display_name text,
  venmo_handle text,
  zelle_contact text,
  is_registered boolean not null default false,
  created_at   timestamptz not null default now()
);

-- When a user signs up via Supabase Auth, promote or create their users row
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, is_registered)
  values (new.id, new.email, true)
  on conflict (email) do update
    set is_registered = true;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- ============================================================
-- RECEIPTS
-- ============================================================
create table if not exists public.receipts (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.users(id) on delete cascade,
  image_url       text,
  restaurant_name text,
  date            date not null default current_date,
  subtotal        numeric(10,2),
  tax             numeric(10,2),
  tip             numeric(10,2),
  total           numeric(10,2),
  created_at      timestamptz not null default now()
);

-- ============================================================
-- LINE ITEMS
-- ============================================================
create table if not exists public.line_items (
  id          uuid primary key default gen_random_uuid(),
  receipt_id  uuid not null references public.receipts(id) on delete cascade,
  description text not null,
  unit_price  numeric(10,2) not null,
  quantity    integer not null default 1,
  total_price numeric(10,2) not null,
  position    integer not null default 0
);

-- ============================================================
-- ASSIGNMENTS
-- fraction must sum to 1.0 per line_item across all rows
-- ============================================================
create table if not exists public.assignments (
  id              uuid primary key default gen_random_uuid(),
  line_item_id    uuid not null references public.line_items(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  fraction        numeric(5,4) not null check (fraction > 0 and fraction <= 1),
  computed_amount numeric(10,2) not null,
  unique (line_item_id, user_id)
);

-- ============================================================
-- SETTLEMENTS
-- ============================================================
create table if not exists public.settlements (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references public.receipts(id) on delete cascade,
  from_user_id    uuid not null references public.users(id),
  to_user_id      uuid not null references public.users(id),
  amount          numeric(10,2) not null,
  paid_at         timestamptz,
  payment_method  text check (payment_method in ('venmo','zelle','cash','other'))
);

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists idx_receipts_owner       on public.receipts(owner_id);
create index if not exists idx_line_items_receipt   on public.line_items(receipt_id);
create index if not exists idx_assignments_user     on public.assignments(user_id);
create index if not exists idx_assignments_lineitem on public.assignments(line_item_id);
create index if not exists idx_settlements_receipt  on public.settlements(receipt_id);
create index if not exists idx_settlements_from     on public.settlements(from_user_id);
create index if not exists idx_settlements_to       on public.settlements(to_user_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- We use service-role key on the backend which bypasses RLS,
-- but policies are here as defence-in-depth for anon clients.
-- ============================================================
alter table public.users       enable row level security;
alter table public.receipts    enable row level security;
alter table public.line_items  enable row level security;
alter table public.assignments enable row level security;
alter table public.settlements enable row level security;

-- users: read own row + placeholder lookup
create policy "users_select_own" on public.users
  for select using (id = auth.uid() or is_registered = false);

create policy "users_update_own" on public.users
  for update using (id = auth.uid());

-- receipts: owner sees all; assignees see receipts they appear on
create policy "receipts_owner" on public.receipts
  for all using (owner_id = auth.uid());

create policy "receipts_assignee_select" on public.receipts
  for select using (
    id in (
      select li.receipt_id from public.line_items li
      join public.assignments a on a.line_item_id = li.id
      where a.user_id = auth.uid()
    )
  );

-- line_items: via receipt access
create policy "line_items_select" on public.line_items
  for select using (
    receipt_id in (
      select id from public.receipts
      where owner_id = auth.uid()
         or id in (
           select li2.receipt_id from public.line_items li2
           join public.assignments a2 on a2.line_item_id = li2.id
           where a2.user_id = auth.uid()
         )
    )
  );

create policy "line_items_owner_write" on public.line_items
  for all using (
    receipt_id in (select id from public.receipts where owner_id = auth.uid())
  );

-- assignments: users see their own
create policy "assignments_select" on public.assignments
  for select using (
    user_id = auth.uid() or
    line_item_id in (
      select li.id from public.line_items li
      join public.receipts r on r.id = li.receipt_id
      where r.owner_id = auth.uid()
    )
  );

-- settlements: participants see their own
create policy "settlements_select" on public.settlements
  for select using (from_user_id = auth.uid() or to_user_id = auth.uid());

create policy "settlements_insert" on public.settlements
  for insert with check (from_user_id = auth.uid());
