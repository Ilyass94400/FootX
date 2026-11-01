-- =====================================================================
-- FootX : collection par joueur + ouverture des boosters côté serveur
-- À coller dans Supabase > SQL Editor > New query, puis "Run".
-- Peut être relancé sans risque (ne supprime aucune donnée).
-- =====================================================================

-- 1. Profils joueurs (1 ligne par compte Discord) --------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  username         text,
  avatar_url       text,
  stock            int  not null default 20,          -- boosters dispo
  stock_updated_at timestamptz not null default now(),
  boosters_opened  int  not null default 0,           -- sert à la pity
  created_at       timestamptz not null default now()
);

-- 2. Cartes possédées (card_id prend automatiquement le type de cards.id)
do $$
declare t text;
begin
  select format_type(atttypid, atttypmod) into t
  from pg_attribute
  where attrelid = 'public.cards'::regclass and attname = 'id';

  execute format($f$
    create table if not exists public.user_cards (
      user_id           uuid not null references public.profiles(id) on delete cascade,
      card_id           %s   not null references public.cards(id) on delete cascade,
      quantity          int  not null default 1 check (quantity >= 0),
      first_obtained_at timestamptz not null default now(),
      primary key (user_id, card_id)
    )$f$, t);
end $$;

-- 3. Sécurité (RLS) ----------------------------------------------------
-- Lecture : chacun voit les profils (pour le classement) et SES cartes.
-- Écriture : aucune directe. Tout passe par les fonctions plus bas.
alter table public.profiles   enable row level security;
alter table public.user_cards enable row level security;

drop policy if exists "profils lisibles" on public.profiles;
create policy "profils lisibles" on public.profiles
  for select to authenticated using (true);

drop policy if exists "mes cartes" on public.user_cards;
create policy "mes cartes" on public.user_cards
  for select to authenticated using (user_id = auth.uid());

-- 4. Rang des raretés ----------------------------------------------------
create or replace function public._rarity_rank(r text)
returns int language sql immutable as $$
  select case lower(r)
    when 'commune' then 1 when 'atypique' then 2 when 'rare' then 3
    when 'epique' then 4 when 'legendaire' then 5 when 'iconique' then 6
    else 0 end
$$;

-- 5. Crée le profil si besoin + recharge le stock -----------------------
--    +1 booster toutes les 10 min, 100 max.
create or replace function public._ensure_profile()
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  p public.profiles;
  gained int;
begin
  if u is null then raise exception 'Il faut être connecté'; end if;

  insert into profiles (id, username, avatar_url)
  select id,
         coalesce(raw_user_meta_data->'custom_claims'->>'global_name',
                  raw_user_meta_data->>'full_name',
                  raw_user_meta_data->>'name'),
         raw_user_meta_data->>'avatar_url'
  from auth.users where id = u
  on conflict (id) do nothing;

  select * into p from profiles where id = u for update;  -- verrou : pas de double dépense

  if p.stock >= 100 then
    p.stock_updated_at := now();
  else
    gained := floor(extract(epoch from now() - p.stock_updated_at) / 600);
    if gained > 0 then
      p.stock := least(100, p.stock + gained);
      p.stock_updated_at := case when p.stock >= 100 then now()
                                 else p.stock_updated_at + gained * interval '10 minutes' end;
    end if;
  end if;

  update profiles set stock = p.stock, stock_updated_at = p.stock_updated_at where id = u;
  return p;
end $$;

-- 6. Stock du joueur connecté -------------------------------------------
create or replace function public.get_my_stock()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  p := _ensure_profile();
  return jsonb_build_object(
    'stock', p.stock,
    'boosters_opened', p.boosters_opened,
    'next_in', case when p.stock >= 100 then null
                    else greatest(0, 600 - extract(epoch from now() - p.stock_updated_at))::int end
  );
end $$;

-- 7. Ouvrir 1 à 100 boosters ---------------------------------------------
--    Par booster : 9 cartes au hasard + 1 garantie
--    (Rare+ ; Épique+ tous les 10 ; Iconique tous les 200).
create or replace function public.open_boosters(qty int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  p public.profiles;
  pool_any jsonb; pool_rare jsonb; pool_epic jsonb; pool_icon jsonb;
  pool jsonb;
  pulled jsonb[] := '{}';
  new_ids jsonb;
  b int; s int; n int;
begin
  if qty is null or qty < 1 or qty > 100 then
    raise exception 'Quantité invalide (1 à 100)';
  end if;

  p := _ensure_profile();
  if p.stock < qty then
    raise exception 'Pas assez de boosters (% dispo)', p.stock;
  end if;

  select coalesce(jsonb_agg(to_jsonb(c)), '[]'),
         coalesce(jsonb_agg(to_jsonb(c)) filter (where _rarity_rank(c.rarity) >= 3), '[]'),
         coalesce(jsonb_agg(to_jsonb(c)) filter (where _rarity_rank(c.rarity) >= 4), '[]'),
         coalesce(jsonb_agg(to_jsonb(c)) filter (where _rarity_rank(c.rarity) >= 6), '[]')
  into pool_any, pool_rare, pool_epic, pool_icon
  from (select id, name, club, country, position, rarity, image_url from cards) c;

  if jsonb_array_length(pool_any) = 0 then raise exception 'Catalogue vide'; end if;

  for b in 1..qty loop
    for s in 1..10 loop
      if s < 10 then
        pool := pool_any;
      elsif (p.boosters_opened + b) % 200 = 0 and jsonb_array_length(pool_icon) > 0 then
        pool := pool_icon;
      elsif (p.boosters_opened + b) % 10 = 0 and jsonb_array_length(pool_epic) > 0 then
        pool := pool_epic;
      elsif jsonb_array_length(pool_rare) > 0 then
        pool := pool_rare;
      else
        pool := pool_any;
      end if;
      n := floor(random() * jsonb_array_length(pool));
      pulled := pulled || (pool -> n);
    end loop;
  end loop;

  -- cartes que le joueur n'avait pas encore
  select coalesce(jsonb_agg(distinct e->>'id'), '[]') into new_ids
  from unnest(pulled) e
  where not exists (
    select 1 from user_cards uc where uc.user_id = u and uc.card_id::text = e->>'id'
  );

  insert into user_cards (user_id, card_id, quantity)
  select u, c.id, count(*)
  from unnest(pulled) e
  join cards c on c.id::text = e->>'id'
  group by c.id
  on conflict (user_id, card_id)
  do update set quantity = user_cards.quantity + excluded.quantity;

  update profiles
  set stock = stock - qty,
      boosters_opened = boosters_opened + qty,
      stock_updated_at = case when p.stock >= 100 then now() else stock_updated_at end
  where id = u
  returning * into p;

  return jsonb_build_object(
    'cards', to_jsonb(pulled),
    'new_ids', new_ids,
    'stock', p.stock,
    'boosters_opened', p.boosters_opened,
    'next_in', case when p.stock >= 100 then null
                    else greatest(0, 600 - extract(epoch from now() - p.stock_updated_at))::int end
  );
end $$;

-- 8. Qui peut appeler quoi -------------------------------------------------
revoke all on function public._ensure_profile()   from public, anon, authenticated;
revoke all on function public.get_my_stock()      from public, anon;
revoke all on function public.open_boosters(int)  from public, anon;
grant execute on function public.get_my_stock()     to authenticated;
grant execute on function public.open_boosters(int) to authenticated;
