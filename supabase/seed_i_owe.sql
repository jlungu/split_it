-- Additional seed: receipts owned by friends where you owe them
-- Run AFTER seed.sql has already been run (friends must exist)

do $$
declare
  me_id     uuid;
  alex_id   uuid;
  sam_id    uuid;
  priya_id  uuid;

  receipt4_id uuid := gen_random_uuid();
  receipt5_id uuid := gen_random_uuid();

  li_id uuid;
begin

  select id into me_id    from public.users where is_registered = true order by created_at desc limit 1;
  select id into alex_id  from public.users where email = 'alex@example.com';
  select id into sam_id   from public.users where email = 'sam@example.com';
  select id into priya_id from public.users where email = 'priya@example.com';

  if me_id is null   then raise exception 'No registered user found.'; end if;
  if alex_id is null then raise exception 'Run seed.sql first (alex not found).'; end if;

  -- ── Receipt 4: Carbone — Alex paid, you + sam split it ──────────────────────
  insert into public.receipts (id, owner_id, restaurant_name, date, subtotal, tax, tip, total)
  values (receipt4_id, alex_id, 'Carbone', current_date - 5, 210.00, 18.90, 42.00, 270.90);

  -- Rigatoni vodka (you + alex, equal)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt4_id, 'Rigatoni alla vodka', 36.00, 2, 72.00, 0)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, me_id,   0.5, 36.00),
    (li_id, alex_id, 0.5, 36.00);

  -- Veal parmesan (you solo)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt4_id, 'Veal parmesan', 54.00, 1, 54.00, 1)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, me_id, 1.0, 54.00);

  -- Spicy rigatoni (sam + alex, equal)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt4_id, 'Spicy rigatoni', 34.00, 1, 34.00, 2)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, sam_id,   0.5, 17.00),
    (li_id, alex_id,  0.5, 17.00);

  -- Tiramisu (you + alex + sam, equal three-way)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt4_id, 'Tiramisu', 24.00, 1, 24.00, 3)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, me_id,   0.3334,  8.00),
    (li_id, alex_id, 0.3333,  8.00),
    (li_id, sam_id,  0.3333,  8.00);

  -- Wine bottle (all three, equal)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt4_id, 'Barolo wine bottle', 110.00, 1, 110.00, 4)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, me_id,   0.3334, 36.67),
    (li_id, alex_id, 0.3333, 36.67),
    (li_id, sam_id,  0.3333, 36.66);

  -- ── Receipt 5: Erewhon — Priya paid, you + priya split ──────────────────────
  insert into public.receipts (id, owner_id, restaurant_name, date, subtotal, tax, tip, total)
  values (receipt5_id, priya_id, 'Erewhon Market', current_date - 2, 68.50, 5.99, 0.00, 74.49);

  -- Smoothie (you + priya)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt5_id, 'Hailey Bieber smoothie', 22.00, 2, 44.00, 0)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, me_id,    0.5, 22.00),
    (li_id, priya_id, 0.5, 22.00);

  -- Acai bowl (priya only)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt5_id, 'Acai bowl', 18.00, 1, 18.00, 1)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, priya_id, 1.0, 18.00);

  -- Collagen water (you)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt5_id, 'Collagen water', 9.00, 1, 9.00, 2)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, me_id, 1.0, 9.00);

  -- Supplements (you)
  insert into public.line_items (id, receipt_id, description, unit_price, quantity, total_price, position)
  values (gen_random_uuid(), receipt5_id, 'Magnesium gummies', 14.50, 1, 14.50, 3)
  returning id into li_id;
  insert into public.assignments (line_item_id, user_id, fraction, computed_amount) values
    (li_id, me_id, 1.0, 14.50);

  raise notice 'Done! You owe Alex ~$130 and Priya ~$45.';
end $$;
