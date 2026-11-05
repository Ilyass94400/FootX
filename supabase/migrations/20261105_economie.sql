-- =============================================================================
-- FootX TCG — Économie X-Coins + Marché des transferts
-- Dépend de 20261104_arene_ligue.sql (profiles, user_cards, arena_matches).
--
-- PRINCIPE DE SÉCURITÉ : le client ne peut JAMAIS écrire un solde ni une ligne
-- de grand livre. Les tables sont en lecture seule pour lui (RLS sans policy
-- d'écriture + REVOKE). Toute opération qui touche à l'argent passe par une
-- fonction SECURITY DEFINER qui :
--   1. vérifie l'identité (auth.uid()) et les règles métier,
--   2. verrouille les lignes concernées (SELECT … FOR UPDATE) → pas de double dépense,
--   3. écrit le mouvement dans le grand livre (append-only, clé d'idempotence unique),
--   4. met à jour le solde (CHECK balance >= 0 → impossible de passer en négatif).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. PARAMÈTRES ÉCONOMIQUES (lisibles par tous, modifiables seulement en admin)
-- -----------------------------------------------------------------------------
create table if not exists public.economy_rarity (
  rarity     text primary key,
  quicksell  bigint not null,           -- vente rapide (le jeu rachète)
  min_price  bigint not null,           -- plancher sur le marché (> quicksell : vendre aux joueurs rapporte plus)
  max_price  bigint not null,           -- plafond (bloque le blanchiment de coins entre comptes)
  check (quicksell > 0 and min_price > quicksell and max_price > min_price)
);
insert into public.economy_rarity values
  ('commune',     40,    150,     5000),
  ('atypique',    80,    250,    10000),
  ('rare',       200,    500,    25000),
  ('epique',     600,   1500,   100000),
  ('legendaire',2000,   5000,   500000),
  ('iconique',  6000,  15000,  2000000)
on conflict (rarity) do nothing;

create table if not exists public.economy_settings (
  id              boolean primary key default true check (id),
  start_balance   bigint not null default 5000,
  match_win       bigint not null default 500,
  match_loss      bigint not null default 100,
  match_daily_cap int    not null default 30,      -- matchs récompensés par jour (anti-farm)
  booster_price   bigint not null default 1500,
  market_tax_pct  int    not null default 5,       -- taxe vendeur = puits de monnaie
  bid_step_pct    int    not null default 5,       -- surenchère minimale
  anti_snipe_sec  int    not null default 30,      -- une enchère dans les 30 dernières s prolonge
  max_listings    int    not null default 30
);
insert into public.economy_settings default values on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 1. SOLDES + GRAND LIVRE
-- -----------------------------------------------------------------------------
create table if not exists public.user_balances (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  balance    bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions_history (
  id              bigserial primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  amount          bigint not null check (amount <> 0),          -- + crédit / − débit
  balance_after   bigint not null check (balance_after >= 0),
  kind            text not null check (kind in ('start','match_reward','league_reward','quicksell','booster',
                    'bid_hold','bid_refund','market_buy','market_sale','admin')),
  ref_id          text,                                           -- annonce, match, journée…
  idempotency_key text unique,                                    -- rejouer la même requête ne paie pas 2 fois
  created_at      timestamptz not null default now()
);
create index if not exists tx_user_idx on public.transactions_history(user_id, created_at desc);

-- Stock de boosters achetés (le tirage des cartes doit aussi passer côté serveur, voir notes).
create table if not exists public.user_boosters (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  stock   int not null default 0 check (stock between 0 and 10)   -- 10 boosters stockés au maximum
);

-- Une carte mise en vente est bloquée (ni vente rapide, ni 2e annonce, ni compo).
alter table public.user_cards add column if not exists listing_id uuid;

-- -----------------------------------------------------------------------------
-- 2. MARCHÉ
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.listing_status as enum ('active','sold','expired','cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.market_listings (
  id             uuid primary key default gen_random_uuid(),
  seller_id      uuid not null references public.profiles(id),
  user_card_id   uuid not null references public.user_cards(id),
  card_id        bigint not null references public.cards(id),
  -- copies dénormalisées pour filtrer 18 000+ joueurs vite (index), figées à la mise en vente
  card_name      text not null,
  rarity         text not null references public.economy_rarity(rarity),
  position       text,
  club           text,
  country        text,
  start_price    bigint not null,
  buy_now_price  bigint not null,
  current_bid    bigint,
  current_bidder uuid references public.profiles(id),
  bid_count      int not null default 0,
  status         public.listing_status not null default 'active',
  created_at     timestamptz not null default now(),
  ends_at        timestamptz not null,
  settled_at     timestamptz,
  buyer_id       uuid references public.profiles(id),
  final_price    bigint,
  check (buy_now_price > start_price),
  check (current_bid is null or current_bid between start_price and buy_now_price)
);
-- une carte ne peut avoir qu'UNE annonce active
create unique index if not exists listing_one_active on public.market_listings(user_card_id) where status = 'active';
create index if not exists listing_browse_idx  on public.market_listings(status, ends_at);
create index if not exists listing_rarity_idx  on public.market_listings(status, rarity, buy_now_price);
create index if not exists listing_club_idx    on public.market_listings(status, club);
create index if not exists listing_country_idx on public.market_listings(status, country);
create index if not exists listing_name_idx    on public.market_listings using gin (to_tsvector('simple', card_name));

create table if not exists public.market_bids (
  id         bigserial primary key,
  listing_id uuid not null references public.market_listings(id) on delete cascade,
  bidder_id  uuid not null references public.profiles(id),
  amount     bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists bids_listing_idx on public.market_bids(listing_id, amount desc);

-- -----------------------------------------------------------------------------
-- 3. RLS : lecture seulement. AUCUNE policy insert/update/delete pour les joueurs.
-- -----------------------------------------------------------------------------
alter table public.economy_rarity       enable row level security;
alter table public.economy_settings     enable row level security;
alter table public.user_balances        enable row level security;
alter table public.transactions_history enable row level security;
alter table public.user_boosters        enable row level security;
alter table public.market_listings      enable row level security;
alter table public.market_bids          enable row level security;

create policy "barème public"      on public.economy_rarity   for select using (true);
create policy "réglages publics"   on public.economy_settings for select using (true);
create policy "mon solde"          on public.user_balances        for select using (user_id = auth.uid());
create policy "mon historique"     on public.transactions_history for select using (user_id = auth.uid());
create policy "mes boosters"       on public.user_boosters        for select using (user_id = auth.uid());
create policy "marché public"      on public.market_listings for select using (status = 'active' or seller_id = auth.uid() or buyer_id = auth.uid() or current_bidder = auth.uid());
create policy "enchères visibles"  on public.market_bids for select using (
  bidder_id = auth.uid() or exists (select 1 from public.market_listings l where l.id = listing_id and l.seller_id = auth.uid()));

-- Ceinture + bretelles : même si une policy était ajoutée par erreur, le rôle client n'a pas le droit d'écrire.
revoke insert, update, delete on public.user_balances, public.transactions_history, public.user_boosters,
  public.market_listings, public.market_bids, public.economy_rarity, public.economy_settings from anon, authenticated;
-- les cartes aussi ne changent de main QUE via les fonctions
revoke insert, update, delete on public.user_cards from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. NOYAU : mouvement d'argent (interne, jamais appelable par un client)
-- -----------------------------------------------------------------------------
create or replace function public._move_coins(p_user uuid, p_amount bigint, p_kind text, p_ref text, p_key text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_bal bigint;
begin
  if p_key is not null and exists (select 1 from transactions_history where idempotency_key = p_key) then
    select balance into v_bal from user_balances where user_id = p_user;
    return v_bal;                                   -- déjà fait : on ne paie pas deux fois
  end if;
  insert into user_balances(user_id, balance) values (p_user, 0) on conflict (user_id) do nothing;
  select balance into v_bal from user_balances where user_id = p_user for update;   -- verrou de ligne
  if v_bal + p_amount < 0 then
    raise exception 'Solde insuffisant' using errcode = 'P0001', hint = 'insufficient_funds';
  end if;
  update user_balances set balance = v_bal + p_amount, updated_at = now() where user_id = p_user;
  insert into transactions_history(user_id, amount, balance_after, kind, ref_id, idempotency_key)
    values (p_user, p_amount, v_bal + p_amount, p_kind, p_ref, p_key);
  return v_bal + p_amount;
end $$;

-- Solde de départ à la création du profil.
create or replace function public._start_balance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _move_coins(new.id, (select start_balance from economy_settings), 'start', null, 'start:' || new.id);
  return new;
end $$;
drop trigger if exists profiles_start_balance on public.profiles;
create trigger profiles_start_balance after insert on public.profiles for each row execute function public._start_balance();

-- Règlement d'une annonce (interne) : la carte change de propriétaire, le vendeur touche le prix − taxe.
create or replace function public._settle_sale(p_listing uuid, p_buyer uuid, p_price bigint)
returns void language plpgsql security definer set search_path = public as $$
declare l market_listings; v_tax int;
begin
  select * into l from market_listings where id = p_listing for update;
  select market_tax_pct into v_tax from economy_settings;
  update user_cards set owner_id = p_buyer, listing_id = null, source = 'trade' where id = l.user_card_id;
  update market_listings set status = 'sold', buyer_id = p_buyer, final_price = p_price, settled_at = now() where id = p_listing;
  perform _move_coins(l.seller_id, p_price - (p_price * v_tax / 100), 'market_sale', p_listing::text, 'sale:' || p_listing);
end $$;

-- -----------------------------------------------------------------------------
-- 5. ACTIONS JOUEUR (les seules appelables depuis le client)
-- -----------------------------------------------------------------------------

-- Vente rapide : le jeu rachète les cartes au prix du barème.
create or replace function public.quicksell_cards(p_cards uuid[])
returns bigint language plpgsql security definer set search_path = public as $$
declare v_total bigint; v_n int;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  select count(*), coalesce(sum(r.quicksell), 0) into v_n, v_total
    from user_cards uc join cards c on c.id = uc.card_id join economy_rarity r on r.rarity = lower(c.rarity)
    where uc.id = any(p_cards) and uc.owner_id = auth.uid() and uc.listing_id is null;
  if v_n <> coalesce(array_length(p_cards, 1), 0) then
    raise exception 'Carte introuvable, déjà vendue ou en vente' using hint = 'not_owner';
  end if;
  delete from user_cards where id = any(p_cards) and owner_id = auth.uid() and listing_id is null;
  return _move_coins(auth.uid(), v_total, 'quicksell', array_to_string(p_cards, ','), null);
end $$;

-- Achat de boosters dans la boutique.
create or replace function public.buy_boosters(p_n int, p_request_id text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_bal bigint;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if p_n not between 1 and 10 then raise exception 'Quantité invalide'; end if;
  if coalesce((select stock from user_boosters where user_id = auth.uid() for update), 0) + p_n > 10 then
    raise exception 'Stock plein (10 boosters max)' using hint = 'stock_full';      -- on refuse AVANT de débiter
  end if;
  v_bal := _move_coins(auth.uid(), -(p_n * (select booster_price from economy_settings)), 'booster', p_n::text, 'booster:' || auth.uid() || ':' || p_request_id);
  insert into user_boosters(user_id, stock) values (auth.uid(), p_n)
    on conflict (user_id) do update set stock = user_boosters.stock + p_n;
  return v_bal;
end $$;

-- Récompense de fin de match : uniquement pour un match TERMINÉ, validé serveur, une seule fois.
create or replace function public.claim_match_reward(p_match uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare m arena_matches; s economy_settings; v_today int;
begin
  select * into s from economy_settings;
  select * into m from arena_matches where id = p_match;
  if m.id is null or m.status <> 'finished' or auth.uid() not in (m.home_id, coalesce(m.away_id, m.home_id)) then
    raise exception 'Match non valide';
  end if;
  select count(*) into v_today from transactions_history
    where user_id = auth.uid() and kind = 'match_reward' and created_at > date_trunc('day', now());
  if v_today >= s.match_daily_cap then raise exception 'Limite de récompenses du jour atteinte'; end if;
  return _move_coins(auth.uid(), case when m.winner_id = auth.uid() then s.match_win else s.match_loss end,
    'match_reward', p_match::text, 'match:' || p_match || ':' || auth.uid());
end $$;

-- Mise en vente.
create or replace function public.create_listing(p_card uuid, p_start bigint, p_buy_now bigint, p_hours int)
returns uuid language plpgsql security definer set search_path = public as $$
declare uc user_cards; c cards; r economy_rarity; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if p_hours not in (1, 6, 24) then raise exception 'Durée invalide (1h, 6h ou 24h)'; end if;
  select * into uc from user_cards where id = p_card for update;
  if uc.owner_id is distinct from auth.uid() then raise exception 'Cette carte ne t''appartient pas' using hint = 'not_owner'; end if;
  if uc.listing_id is not null then raise exception 'Carte déjà en vente'; end if;
  if (select count(*) from market_listings where seller_id = auth.uid() and status = 'active') >= (select max_listings from economy_settings) then
    raise exception 'Trop d''annonces actives';
  end if;
  select * into c from cards where id = uc.card_id;
  select * into r from economy_rarity where rarity = lower(c.rarity);
  if r.rarity is null or p_start < r.min_price or p_buy_now > r.max_price or p_buy_now <= p_start then
    raise exception 'Prix hors fourchette (% – %)', r.min_price, r.max_price using hint = 'price_range';
  end if;
  insert into market_listings(seller_id, user_card_id, card_id, card_name, rarity, position, club, country, start_price, buy_now_price, ends_at)
    values (auth.uid(), uc.id, c.id, c.name, r.rarity, c.position, c.club, c.country, p_start, p_buy_now, now() + make_interval(hours => p_hours))
    returning id into v_id;
  update user_cards set listing_id = v_id where id = uc.id;
  return v_id;
end $$;

-- Enchère : l'argent de l'enchérisseur est BLOQUÉ (débité), l'ancien meilleur est remboursé.
create or replace function public.place_bid(p_listing uuid, p_amount bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare l market_listings; s economy_settings; v_min bigint;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  select * into s from economy_settings;
  select * into l from market_listings where id = p_listing for update;        -- sérialise les enchères
  if l.id is null or l.status <> 'active' or l.ends_at <= now() then raise exception 'Enchère terminée' using hint = 'closed'; end if;
  if l.seller_id = auth.uid() then raise exception 'Tu ne peux pas enchérir sur ta propre carte'; end if;
  if l.current_bidder = auth.uid() then raise exception 'Tu es déjà le meilleur enchérisseur'; end if;
  v_min := case when l.current_bid is null then l.start_price
                else greatest(l.current_bid + 50, ceil(l.current_bid * (100 + s.bid_step_pct) / 100.0 / 50) * 50) end;
  if p_amount < v_min then raise exception 'Enchère minimale : %', v_min using hint = 'bid_too_low'; end if;
  if p_amount >= l.buy_now_price then raise exception 'Utilise l''achat immédiat' using hint = 'use_buy_now'; end if;
  perform _move_coins(auth.uid(), -p_amount, 'bid_hold', p_listing::text, null);                 -- bloque l'argent
  if l.current_bidder is not null then
    perform _move_coins(l.current_bidder, l.current_bid, 'bid_refund', p_listing::text, null);    -- rembourse l'ancien
  end if;
  update market_listings set current_bid = p_amount, current_bidder = auth.uid(), bid_count = bid_count + 1,
    ends_at = greatest(ends_at, now() + make_interval(secs => s.anti_snipe_sec))
    where id = p_listing;
  insert into market_bids(listing_id, bidder_id, amount) values (p_listing, auth.uid(), p_amount);
  return p_amount;
end $$;

-- Achat immédiat.
create or replace function public.buy_now(p_listing uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare l market_listings;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  select * into l from market_listings where id = p_listing for update;        -- 2 acheteurs simultanés : le 2e attend puis voit "vendu"
  if l.id is null or l.status <> 'active' or l.ends_at <= now() then raise exception 'Déjà vendu ou terminé' using hint = 'closed'; end if;
  if l.seller_id = auth.uid() then raise exception 'C''est ta propre carte'; end if;
  perform _move_coins(auth.uid(), -l.buy_now_price, 'market_buy', p_listing::text, 'buy:' || p_listing || ':' || auth.uid());
  if l.current_bidder is not null then
    perform _move_coins(l.current_bidder, l.current_bid, 'bid_refund', p_listing::text, 'refund:' || p_listing || ':' || l.bid_count);
  end if;
  perform _settle_sale(p_listing, auth.uid(), l.buy_now_price);
  return l.buy_now_price;
end $$;

-- Retirer une annonce (seulement sans enchère).
create or replace function public.cancel_listing(p_listing uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l market_listings;
begin
  select * into l from market_listings where id = p_listing for update;
  if l.seller_id is distinct from auth.uid() then raise exception 'Annonce introuvable'; end if;
  if l.status <> 'active' then raise exception 'Annonce déjà terminée'; end if;
  if l.current_bidder is not null then raise exception 'Impossible : il y a déjà une enchère'; end if;
  update market_listings set status = 'cancelled', settled_at = now() where id = p_listing;
  update user_cards set listing_id = null where id = l.user_card_id;
end $$;

-- Clôture des enchères échues (planifiée chaque minute, appelable aussi par le client : elle ne fait
-- que ce que les règles prévoient, donc sans risque).
create or replace function public.settle_expired_listings()
returns int language plpgsql security definer set search_path = public as $$
declare l record; v_n int := 0;
begin
  for l in select id, current_bidder, current_bid, user_card_id from market_listings
           where status = 'active' and ends_at <= now() for update skip locked loop
    if l.current_bidder is not null then
      perform _settle_sale(l.id, l.current_bidder, l.current_bid);     -- l'argent était déjà bloqué
    else
      update market_listings set status = 'expired', settled_at = now() where id = l.id;
      update user_cards set listing_id = null where id = l.user_card_id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Récompense de Ligue (serveur uniquement : appelée par l'Edge Function du lundi).
create or replace function public.grant_league_reward(p_user uuid, p_gameweek int, p_amount bigint)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  return _move_coins(p_user, p_amount, 'league_reward', p_gameweek::text, 'league:' || p_gameweek || ':' || p_user);
end $$;

-- -----------------------------------------------------------------------------
-- 6. DROITS D'EXÉCUTION : par défaut Postgres/Supabase autorise tout le monde.
-- -----------------------------------------------------------------------------
revoke execute on function public._move_coins(uuid, bigint, text, text, text) from public, anon, authenticated;
revoke execute on function public._settle_sale(uuid, uuid, bigint) from public, anon, authenticated;
revoke execute on function public._start_balance() from public, anon, authenticated;
revoke execute on function public.grant_league_reward(uuid, int, bigint) from public, anon, authenticated;
revoke execute on function public.quicksell_cards(uuid[]), public.buy_boosters(int, text), public.claim_match_reward(uuid),
  public.create_listing(uuid, bigint, bigint, int), public.place_bid(uuid, bigint), public.buy_now(uuid),
  public.cancel_listing(uuid), public.settle_expired_listings() from public, anon;
grant execute on function public.quicksell_cards(uuid[]), public.buy_boosters(int, text), public.claim_match_reward(uuid),
  public.create_listing(uuid, bigint, bigint, int), public.place_bid(uuid, bigint), public.buy_now(uuid),
  public.cancel_listing(uuid), public.settle_expired_listings() to authenticated;

-- Temps réel : prix et soldes poussés aux clients abonnés.
alter publication supabase_realtime add table public.market_listings;
alter publication supabase_realtime add table public.user_balances;

-- Planification (extension pg_cron à activer dans Supabase > Database > Extensions) :
-- select cron.schedule('market-settle', '* * * * *', $$ select public.settle_expired_listings() $$);
