alter table public.ustad_coin_ledger
  add column if not exists direction text,
  add column if not exists tx_type text not null default 'legacy',
  add column if not exists balance_before bigint,
  add column if not exists balance_after bigint,
  add column if not exists status text not null default 'completed';

update public.ustad_coin_ledger
   set direction = case when coins < 0 then 'SPEND' else 'EARN' end
 where direction is null;

alter table public.ustad_coin_ledger
  alter column direction set default 'EARN';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ustad_coin_ledger_direction_ck') then
    alter table public.ustad_coin_ledger
      add constraint ustad_coin_ledger_direction_ck
      check (direction in ('EARN', 'SPEND')
             and ((coins < 0 and direction = 'SPEND') or (coins >= 0 and direction = 'EARN')));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ustad_coin_ledger_status_ck') then
    alter table public.ustad_coin_ledger
      add constraint ustad_coin_ledger_status_ck
      check (status in ('completed', 'reversed'));
  end if;
end $$;

create table if not exists public.ustad_wallets (
  wallet_id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests (id) on delete cascade,
  current_balance bigint not null default 0,
  lifetime_earned bigint not null default 0,
  lifetime_spent bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ustad_wallets_guest_unique unique (guest_id),
  constraint ustad_wallets_non_negative check (current_balance >= 0),
  constraint ustad_wallets_lifetime_ck check (lifetime_earned >= 0 and lifetime_spent >= 0)
);

insert into public.ustad_wallets (guest_id, current_balance, lifetime_earned, lifetime_spent)
select l.guest_id,
       greatest(sum(l.coins), 0),
       coalesce(sum(l.coins) filter (where l.coins > 0), 0),
       coalesce(-sum(l.coins) filter (where l.coins < 0), 0)
  from public.ustad_coin_ledger l
 where l.status = 'completed'
 group by l.guest_id
on conflict (guest_id) do nothing;

create table if not exists public.ustad_shop_items (
  item_id text primary key,
  name text not null,
  category text not null,
  price_coins bigint not null check (price_coins > 0),
  description text not null default '',
  asset_reference text not null default '',
  status text not null default 'active' check (status in ('active', 'hidden', 'retired')),
  availability text not null default 'permanent' check (availability in ('permanent', 'limited')),
  ownership_type text not null default 'permanent' check (ownership_type in ('permanent', 'consumable')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ustad_shop_items_category_idx
  on public.ustad_shop_items (category, sort_order);

create table if not exists public.ustad_purchases (
  purchase_id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests (id) on delete cascade,
  item_id text not null references public.ustad_shop_items (item_id) on delete restrict,
  price_paid bigint not null check (price_paid >= 0),
  transaction_id uuid references public.ustad_coin_ledger (id) on delete set null,
  purchased_at timestamptz not null default now(),
  ownership_status text not null default 'owned' check (ownership_status in ('owned', 'revoked')),
  constraint ustad_purchases_once unique (guest_id, item_id)
);
create index if not exists ustad_purchases_guest_idx
  on public.ustad_purchases (guest_id, purchased_at desc);

create or replace function public.ustad_coin_apply(
  p_guest_id text,
  p_source text,
  p_ref_id text,
  p_amount bigint,
  p_type text default 'general',
  p_note text default ''
) returns table (
  transaction_id uuid,
  balance_before bigint,
  balance_after bigint,
  applied boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.ustad_wallets%rowtype;
  v_existing public.ustad_coin_ledger%rowtype;
  v_before bigint;
  v_after bigint;
  v_id uuid;
begin
  if p_amount = 0 then
    raise exception 'A coin transaction cannot be zero';
  end if;

  select * into v_existing
    from public.ustad_coin_ledger
   where guest_id = p_guest_id and source = p_source and ref_id = p_ref_id;
  if found then
    return query select v_existing.id, v_existing.balance_before, v_existing.balance_after, false;
    return;
  end if;

  insert into public.guests (id) values (p_guest_id) on conflict (id) do nothing;
  insert into public.ustad_wallets (guest_id) values (p_guest_id) on conflict (guest_id) do nothing;

  select * into v_wallet from public.ustad_wallets where guest_id = p_guest_id for update;

  v_before := v_wallet.current_balance;
  v_after := v_before + p_amount;

  if v_after < 0 then
    raise exception 'INSUFFICIENT_COINS: balance % cannot cover %', v_before, p_amount
      using errcode = 'check_violation';
  end if;

  insert into public.ustad_coin_ledger
    (guest_id, source, ref_id, coins, note, direction, tx_type, balance_before, balance_after, status)
  values
    (p_guest_id, p_source, p_ref_id, p_amount, coalesce(p_note, ''),
     case when p_amount < 0 then 'SPEND' else 'EARN' end,
     coalesce(p_type, 'general'), v_before, v_after, 'completed')
  returning id into v_id;

  update public.ustad_wallets
     set current_balance = v_after,
         lifetime_earned = lifetime_earned + greatest(p_amount, 0),
         lifetime_spent = lifetime_spent + greatest(-p_amount, 0),
         updated_at = now()
   where guest_id = p_guest_id;

  return query select v_id, v_before, v_after, true;
end;
$$;

create or replace function public.ustad_shop_buy(
  p_guest_id text,
  p_item_id text
) returns table (
  purchase_id uuid,
  transaction_id uuid,
  price_paid bigint,
  balance_after bigint,
  already_owned boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.ustad_shop_items%rowtype;
  v_existing public.ustad_purchases%rowtype;
  v_apply record;
  v_purchase_id uuid;
  v_wallet_balance bigint;
begin
  select * into v_item from public.ustad_shop_items where item_id = p_item_id;
  if not found then
    raise exception 'UNKNOWN_ITEM: %', p_item_id;
  end if;
  if v_item.status <> 'active' then
    raise exception 'ITEM_UNAVAILABLE: %', p_item_id;
  end if;

  select * into v_existing
    from public.ustad_purchases
   where guest_id = p_guest_id and item_id = p_item_id and ownership_status = 'owned';
  if found then
    select current_balance into v_wallet_balance
      from public.ustad_wallets where guest_id = p_guest_id;
    return query select v_existing.purchase_id, v_existing.transaction_id,
                        v_existing.price_paid, coalesce(v_wallet_balance, 0), true;
    return;
  end if;

  select * into v_apply from public.ustad_coin_apply(
    p_guest_id, 'shop', 'purchase:' || p_item_id, -v_item.price_coins,
    'shop_purchase', v_item.name);

  insert into public.ustad_purchases
    (guest_id, item_id, price_paid, transaction_id, ownership_status)
  values
    (p_guest_id, p_item_id, v_item.price_coins, v_apply.transaction_id, 'owned')
  returning public.ustad_purchases.purchase_id into v_purchase_id;

  return query select v_purchase_id, v_apply.transaction_id,
                      v_item.price_coins, v_apply.balance_after, false;
end;
$$;

insert into public.crorepati_rewards (event_id, question_number, coins)
select e.id, v.qn, v.coins
from public.crorepati_events e
cross join (values
  (1, 10000), (2, 50000), (3, 100000), (4, 250000), (5, 500000),
  (6, 1000000), (7, 2000000), (8, 4000000), (9, 7500000), (10, 10000000),
  (11, 12500000), (12, 15000000), (13, 17500000), (14, 20000000), (15, 25000000),
  (16, 30000000), (17, 40000000), (18, 50000000), (19, 75000000), (20, 100000000)
) as v(qn, coins)
on conflict (event_id, question_number) do update set coins = excluded.coins;

insert into public.ustad_shop_items
  (item_id, name, category, price_coins, description, asset_reference, sort_order)
values
  ('avatar_basic',        'Basic Frame',            'avatar_frames', 25000,     'A clean starter frame for your avatar.',      'frame/basic',        1),
  ('avatar_silver',       'Silver Frame',           'avatar_frames', 75000,     'A brushed silver avatar frame.',              'frame/silver',       2),
  ('avatar_gold',         'Gold Frame',             'avatar_frames', 250000,    'A warm gold avatar frame.',                   'frame/gold',         3),
  ('avatar_diamond',      'Diamond Frame',          'avatar_frames', 1000000,   'A brilliant diamond avatar frame.',           'frame/diamond',      4),
  ('avatar_master',       'Master Frame',           'avatar_frames', 2500000,   'A master-tier decorative frame.',             'frame/master',       5),
  ('avatar_grandmaster',  'Grandmaster Frame',      'avatar_frames', 10000000,  'Cosmetic frame only — not the Grandmaster achievement.', 'frame/grandmaster', 6),
  ('avatar_ultra',        'Ultra Frame',            'avatar_frames', 50000000,  'Cosmetic frame only — not the Ultra achievement.',       'frame/ultra',       7),
  ('profile_simple',      'Simple Profile Frame',   'profile_frames', 10000,    'A simple border for your profile card.',      'pframe/simple',      1),
  ('profile_premium',     'Premium Profile Frame',  'profile_frames', 50000,    'A premium profile border.',                   'pframe/premium',     2),
  ('profile_gold',        'Gold Profile Frame',     'profile_frames', 200000,   'A gold profile border.',                      'pframe/gold',        3),
  ('profile_diamond',     'Diamond Profile Frame',  'profile_frames', 1000000,  'A diamond profile border.',                   'pframe/diamond',     4),
  ('profile_champion',    'Champion Profile Frame', 'profile_frames', 5000000,  'A champion-styled profile border.',           'pframe/champion',    5),
  ('profile_legend',      'Legend Profile Frame',   'profile_frames', 20000000, 'A legend-styled profile border.',             'pframe/legend',      6),
  ('bg_basic',            'Basic Background',       'profile_themes', 15000,    'A calm background for your profile.',         'bg/basic',           1),
  ('bg_education',        'Education Background',   'profile_themes', 40000,    'Books and learning motifs.',                  'bg/education',       2),
  ('bg_space',            'Space Background',       'profile_themes', 100000,   'Stars and deep space.',                       'bg/space',           3),
  ('bg_science',          'Science Background',     'profile_themes', 250000,   'A science laboratory theme.',                 'bg/science',         4),
  ('bg_royal',            'Royal Background',       'profile_themes', 1000000,  'A rich royal theme.',                         'bg/royal',           5),
  ('bg_diamond',          'Diamond Background',     'profile_themes', 5000000,  'A diamond-lit background.',                   'bg/diamond',         6),
  ('bg_grandmaster',      'Grandmaster Background', 'profile_themes', 10000000, 'Cosmetic background only.',                   'bg/grandmaster',     7),
  ('name_classic',        'Classic Name Style',     'name_styles', 5000,        'A classic typeface for your name.',           'name/classic',       1),
  ('name_premium',        'Premium Name Style',     'name_styles', 25000,       'A premium name treatment.',                   'name/premium',       2),
  ('name_gold',           'Gold Name Style',        'name_styles', 100000,      'A gold name treatment.',                      'name/gold',          3),
  ('name_diamond',        'Diamond Name Style',     'name_styles', 500000,      'A diamond name treatment.',                   'name/diamond',       4),
  ('name_champion',       'Champion Name Style',    'name_styles', 2500000,     'A champion name treatment.',                  'name/champion',      5),
  ('name_legend',         'Legend Name Style',      'name_styles', 10000000,    'A legend name treatment.',                    'name/legend',        6),
  ('badge_learning_star', 'Learning Star',          'badges', 10000,            'A decorative badge. Not a tournament award.', 'badge/star',         1),
  ('badge_quiz_master',   'Quiz Master',            'badges', 50000,            'A decorative badge. Not a tournament award.', 'badge/quiz',         2),
  ('badge_knowledge_pro', 'Knowledge Pro',          'badges', 200000,           'A decorative badge. Not a tournament award.', 'badge/knowledge',    3),
  ('badge_top_learner',   'Top Learner',            'badges', 500000,           'A decorative badge. Not a tournament award.', 'badge/top',          4),
  ('badge_champion',      'Champion Display Badge', 'badges', 1000000,          'A decorative badge. Not a tournament award.', 'badge/champion',     5),
  ('badge_legend',        'Legend Display Badge',   'badges', 5000000,          'A decorative badge. Not a tournament award.', 'badge/legend',       6),
  ('class_basic',         'Basic Theme',            'classroom_themes', 25000,   'A clean classroom look.',                    'class/basic',        1),
  ('class_modern',        'Modern Classroom',       'classroom_themes', 100000,  'A modern classroom look.',                   'class/modern',       2),
  ('class_science',       'Science Theme',          'classroom_themes', 250000,  'A science classroom look.',                  'class/science',      3),
  ('class_future',        'Future Classroom Theme', 'classroom_themes', 1000000, 'A futuristic classroom look.',               'class/future',       4),
  ('class_premium',       'Premium Classroom Theme','classroom_themes', 5000000, 'A premium classroom look.',                  'class/premium',      5),
  ('board_classic',       'Classic Board Theme',    'board_themes', 15000,       'A classic board surface.',                   'board/classic',      1),
  ('board_modern',        'Modern Board Theme',     'board_themes', 75000,       'A modern board surface.',                    'board/modern',       2),
  ('board_premium',       'Premium Board Theme',    'board_themes', 250000,      'A premium board surface.',                   'board/premium',      3),
  ('board_gold',          'Gold Board Theme',       'board_themes', 1000000,     'A gold board surface.',                      'board/gold',         4),
  ('board_diamond',       'Diamond Board Theme',    'board_themes', 5000000,     'A diamond board surface.',                   'board/diamond',      5),
  ('teach_classic',       'Classic Teacher Presentation', 'teacher_themes', 25000,    'Classic presentation visuals.',         'teach/classic',      1),
  ('teach_premium',       'Premium Teacher Presentation', 'teacher_themes', 100000,   'Premium presentation visuals.',         'teach/premium',      2),
  ('teach_gold',          'Gold Presentation',            'teacher_themes', 500000,   'Gold presentation visuals.',            'teach/gold',         3),
  ('teach_diamond',       'Diamond Presentation',         'teacher_themes', 2500000,  'Diamond presentation visuals.',         'teach/diamond',      4),
  ('teach_legend',        'Legend Presentation',          'teacher_themes', 10000000, 'Legend presentation visuals.',          'teach/legend',       5),
  ('tour_frame',          'Tournament Frame',       'tournament_cosmetics', 100000,   'Decorative tournament frame.',          'tour/frame',         1),
  ('tour_champion',       'Champion Frame',         'tournament_cosmetics', 500000,   'Decorative champion frame.',            'tour/champion',      2),
  ('tour_mega',           'Mega Frame',             'tournament_cosmetics', 2500000,  'Decorative mega frame.',                'tour/mega',          3),
  ('tour_winner_theme',   'Winner Display Theme',   'tournament_cosmetics', 10000000, 'Decorative winner display theme.',      'tour/winner',        4),
  ('tour_diamond_champ',  'Diamond Champion Theme', 'tournament_cosmetics', 50000000, 'Decorative diamond champion theme.',    'tour/diamond',       5),
  ('unlock_adv_profile',  'Advanced Profile Customization', 'feature_unlocks', 100000,   'Unlock advanced profile customization.', 'unlock/adv_profile',  1),
  ('unlock_collection',   'Profile Collection View',        'feature_unlocks', 250000,   'Unlock the collection view on your profile.', 'unlock/collection', 2),
  ('unlock_theme_slot',   'Premium Profile Theme Slot',     'feature_unlocks', 500000,   'Unlock an extra profile theme slot.',    'unlock/theme_slot',   3),
  ('unlock_cosmetic_slot','Advanced Cosmetic Slot',         'feature_unlocks', 1000000,  'Unlock an extra cosmetic slot.',         'unlock/cosmetic_slot',4),
  ('unlock_tour_display', 'Premium Tournament Display',     'feature_unlocks', 2500000,  'Unlock the premium tournament display.', 'unlock/tour_display', 5),
  ('unlock_cert_theme',   'Advanced Certificate Display Theme', 'feature_unlocks', 5000000, 'Unlock an advanced certificate display theme.', 'unlock/cert_theme', 6),
  ('unlock_showcase',     'Premium Profile Showcase',       'feature_unlocks', 10000000, 'Unlock the premium profile showcase.',   'unlock/showcase',     7)
on conflict (item_id) do update
  set name = excluded.name,
      category = excluded.category,
      price_coins = excluded.price_coins,
      description = excluded.description,
      asset_reference = excluded.asset_reference,
      sort_order = excluded.sort_order,
      updated_at = now();

grant all on public.ustad_wallets to service_role;
grant all on public.ustad_shop_items to service_role;
grant all on public.ustad_purchases to service_role;

alter table public.ustad_wallets enable row level security;
alter table public.ustad_shop_items enable row level security;
alter table public.ustad_purchases enable row level security;

revoke all on function public.ustad_coin_apply(text, text, text, bigint, text, text) from public, anon;
revoke all on function public.ustad_shop_buy(text, text) from public, anon;
grant execute on function public.ustad_coin_apply(text, text, text, bigint, text, text) to service_role;
grant execute on function public.ustad_shop_buy(text, text) to service_role;