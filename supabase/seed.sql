-- Seed dummy data for Split It
-- Run this in the Supabase SQL editor AFTER signing in to the app at least once
-- (so your user row exists in public.users via the auth trigger)

do $$
declare
  me_id        uuid;
  alex_id      uuid := gen_random_uuid();
  sam_id       uuid := gen_random_uuid();
  priya_id     uuid := gen_random_uuid();

  receipt1_id  uuid := gen_random_uuid();
  receipt2_id  uuid := gen_random_uuid();
  receipt3_id  uuid := gen_random_uuid();

  li_id        uuid;
begin

  -- Find your user (most recently registered)
  select id into me_id from public.users where is_registered = true order by created_at desc limit 1;

  if me_id is null then
    raise exception 'No registered user found. Sign in to the app first, then run this seed.';
  end if;

  -- ── Friends (placeholder accounts) ──────────────────────────────────────────
  insert into public.users (id, email, display_name, venmo_handle, zelle_contact, is_registered) values
    (alex_id,  'alex@example.com',  'Alex',  'alexsmith',  'alex@example.com',  false),
    (sam_id,   'sam@example.com',   'Sam',   'samjones',   'sam@example.com',   false),
    (priya_id, 'priya@example.com', 'Priya', 'priyak',     'priya@example.com', false)
  on conflict (email) do update set
    id           = excluded.id,
    display_name = excluded.display_name,
    venmo_handle = excluded.venmo_handle,
    zelle_contact = excluded.zelle_contact;

  -- Re-fetch in case emails already existed
  select id into alex_id  from public.users where email = 'alex@example.com';
  select id into sam_id   from public.users where email = 'sam@example.com';
  select id into priya_id from public.users where email = 'priya@example.com';

  -- ── Receipt 1: Nobu (4 people) ──────────────────────────────────────────────
  insert into public.receipts (id, owner_id, restaurant_name, date, subtotal, tax, tip, total)
  values (receipt1_id, me_id, 'Nobu Downtown', current_date - 7, 184.00, 16.56, 36.80, 237.36);

  -- Omakase for two (me + alex, equal split)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt1_id, 'Omakase tasting menu', 65.00, 2, 130.00, 0)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, me_id,  0.5, 65.00),
    (li_id, alex_id, 0.5, 65.00);

  -- Wagyu (sam + priya, equal split)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt1_id, 'A5 Wagyu beef', 54.00, 1, 54.00, 1)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, sam_id,   0.5, 27.00),
    (li_id, priya_id, 0.5, 27.00);

  -- ── Receipt 2: Tacos Los Compadres (me + sam + alex) ────────────────────────
  insert into public.receipts (id, owner_id, restaurant_name, date, subtotal, tax, tip, total)
  values (receipt2_id, me_id, 'Tacos Los Compadres', current_date - 3, 47.50, 4.28, 9.50, 61.28);

  -- Birria tacos (all three, equal)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt2_id, 'Birria tacos (x3)', 5.50, 3, 16.50, 0)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, me_id,   0.3334, 5.50),
    (li_id, sam_id,  0.3333, 5.50),
    (li_id, alex_id, 0.3333, 5.50);

  -- Al pastor (me only)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt2_id, 'Al pastor plate', 14.00, 1, 14.00, 1)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, me_id, 1.0, 14.00);

  -- Carnitas burrito (sam)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt2_id, 'Carnitas burrito', 13.00, 1, 13.00, 2)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, sam_id, 1.0, 13.00);

  -- Carne asada bowl (alex)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt2_id, 'Carne asada bowl', 14.00, 1, 14.00, 3)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, alex_id, 1.0, 14.00);

  -- ── Receipt 3: Shake Shack (me + priya) ─────────────────────────────────────
  insert into public.receipts (id, owner_id, restaurant_name, date, subtotal, tax, tip, total)
  values (receipt3_id, me_id, 'Shake Shack', current_date - 1, 32.00, 2.88, 6.40, 41.28);

  -- Double Shackburger (me)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt3_id, 'Double ShackBurger', 10.89, 1, 10.89, 0)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, me_id, 1.0, 10.89);

  -- Chick'n Shack (priya)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt3_id, 'Chick''n Shack', 9.89, 1, 9.89, 1)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, priya_id, 1.0, 9.89);

  -- Fries (me + priya, equal)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt3_id, 'Crinkle cut fries', 4.29, 2, 8.58, 2)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, me_id,   0.5, 4.29),
    (li_id, priya_id, 0.5, 4.29);

  -- Shakes (me + priya, equal)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt3_id, 'Frozen custard shakes', 6.29, 2, 12.58, 3)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, me_id,   0.5, 6.29),
    (li_id, priya_id, 0.5, 6.29);

  -- ── Settlement: Alex paid you back for tacos ─────────────────────────────────
  insert into public.settlements (receipt_id, from_user_id, to_user_id, amount, payment_method, paid_at)
  values (receipt2_id, alex_id, me_id, 14.00, 'venmo', now() - interval '1 day');

  raise notice 'Seed complete! Owner: %', me_id;
end $$;
