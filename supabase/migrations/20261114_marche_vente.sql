-- =============================================================================
-- FootX TCG — MARCHÉ : VENTE AMÉLIORÉE
-- Dépend de 20261105_economie.sql et 20261110_sauvegarde.sql. Peut être relancée sans risque.
--
--  1. L'achat immédiat devient FACULTATIF : une annonce peut être « enchères seulement ».
--     (les enchères restent plafonnées au prix max de la rareté, comme avant)
--  2. market_card_stats() : la popularité d'une carte (ventes récentes, prix payés,
--     enchères, exemplaires en jeu) pour calculer le prix conseillé à la mise en vente.
-- =============================================================================

-- 1) achat immédiat facultatif ---------------------------------------------------
alter table public.market_listings alter column buy_now_price drop not null;

do $$
declare r record;
begin
  -- les anciens contrôles (sans nom) qui exigeaient un prix d'achat immédiat
  for r in select conname from pg_constraint
           where conrelid = 'public.market_listings'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%buy_now_price%'
             and conname not in ('listing_bn_check', 'listing_bid_check')
  loop
    execute format('alter table public.market_listings drop constraint %I', r.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'listing_bn_check' and conrelid = 'public.market_listings'::regclass) then
    alter table public.market_listings add constraint listing_bn_check
      check (buy_now_price is null or buy_now_price > start_price);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listing_bid_check' and conrelid = 'public.market_listings'::regclass) then
    alter table public.market_listings add constraint listing_bid_check
      check (current_bid is null or (current_bid >= start_price and (buy_now_price is null or current_bid <= buy_now_price)));
  end if;
end $$;

-- p_buy_now = null → enchères seulement
create or replace function public.create_listing(p_card uuid, p_start bigint, p_buy_now bigint, p_hours int)
returns uuid language plpgsql security definer set search_path = public as $$
declare uc user_cards; c cards; r economy_rarity; v_id uuid;
begin
  perform _ensure_profile(auth.uid());
  if p_hours not in (1, 6, 24) then raise exception 'Durée invalide (1h, 6h ou 24h)'; end if;
  select * into uc from user_cards where id = p_card for update;
  if uc.owner_id is distinct from auth.uid() then raise exception 'Cette carte ne t''appartient pas' using hint = 'not_owner'; end if;
  if uc.listing_id is not null then raise exception 'Carte déjà en vente'; end if;
  if (select count(*) from market_listings where seller_id = auth.uid() and status = 'active') >= (select max_listings from economy_settings) then
    raise exception 'Trop d''annonces actives' using hint = 'too_many';
  end if;
  select * into c from cards where id = uc.card_id;
  select * into r from economy_rarity where rarity = _rkey(c.rarity);
  if r.rarity is null or p_start is null or p_start < r.min_price or p_start >= r.max_price
     or (p_buy_now is not null and (p_buy_now > r.max_price or p_buy_now <= p_start)) then
    raise exception 'Prix hors fourchette (% – %)', r.min_price, r.max_price using hint = 'price_range';
  end if;
  insert into market_listings(seller_id, user_card_id, card_id, card_name, rarity, position, club, country, start_price, buy_now_price, ends_at)
    values (auth.uid(), uc.id, c.id, c.name, r.rarity, c.position, c.club, c.country, p_start, p_buy_now, now() + make_interval(hours => p_hours))
    returning id into v_id;
  update user_cards set listing_id = v_id where id = uc.id;
  return v_id;
end $$;

create or replace function public.place_bid(p_listing uuid, p_amount bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare l market_listings; s economy_settings; v_min bigint; v_max bigint;
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
  if l.buy_now_price is not null and p_amount >= l.buy_now_price then raise exception 'Utilise l''achat immédiat' using hint = 'use_buy_now'; end if;
  select max_price into v_max from economy_rarity where rarity = l.rarity;
  if p_amount > v_max then raise exception 'Enchère maximale : %', v_max using hint = 'bid_too_high'; end if;
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

create or replace function public.buy_now(p_listing uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare l market_listings;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  select * into l from market_listings where id = p_listing for update;        -- 2 acheteurs simultanés : le 2e attend puis voit "vendu"
  if l.id is null or l.status <> 'active' or l.ends_at <= now() then raise exception 'Déjà vendu ou terminé' using hint = 'closed'; end if;
  if l.buy_now_price is null then raise exception 'Cette vente se fait uniquement aux enchères' using hint = 'no_buy_now'; end if;
  if l.seller_id = auth.uid() then raise exception 'C''est ta propre carte'; end if;
  perform _move_coins(auth.uid(), -l.buy_now_price, 'market_buy', p_listing::text, 'buy:' || p_listing || ':' || auth.uid());
  if l.current_bidder is not null then
    perform _move_coins(l.current_bidder, l.current_bid, 'bid_refund', p_listing::text, 'refund:' || p_listing || ':' || l.bid_count);
  end if;
  perform _settle_sale(p_listing, auth.uid(), l.buy_now_price);
  return l.buy_now_price;
end $$;

-- 2) popularité d'une carte ------------------------------------------------------
create index if not exists listing_card_idx   on public.market_listings(card_id, status);
create index if not exists user_cards_card_idx on public.user_cards(card_id);

-- Pour chaque carte demandée (500 max) : exemplaires en jeu, propriétaires, ventes des 30
-- derniers jours (prix médian, dernier prix), enchères des 7 derniers jours, annonces actives.
-- Ne révèle rien de personnel : seulement des chiffres agrégés.
create or replace function public.market_card_stats(p_cards bigint[])
returns jsonb language sql stable security definer set search_path = public as $$
  with ids as (select distinct unnest(p_cards[1:500]) as card_id),
  own as (
    select uc.card_id, count(*) as copies, count(distinct uc.owner_id) as owners
    from user_cards uc join ids using (card_id) group by uc.card_id
  ),
  sold as (
    select l.card_id, count(*) as sales,
           percentile_cont(0.5) within group (order by l.final_price) as median,
           (array_agg(l.final_price order by l.settled_at desc))[1] as last_price
    from market_listings l join ids using (card_id)
    where l.status = 'sold' and l.settled_at > now() - interval '30 days' and l.final_price is not null
    group by l.card_id
  ),
  act as (
    select l.card_id, count(*) as active, min(l.buy_now_price) as lowest_bn, min(coalesce(l.current_bid, l.start_price)) as lowest_bid
    from market_listings l join ids using (card_id)
    where l.status = 'active' and l.ends_at > now()
    group by l.card_id
  ),
  bids as (
    select l.card_id, count(*) as bids
    from market_bids b join market_listings l on l.id = b.listing_id join ids using (card_id)
    where b.created_at > now() - interval '7 days'
    group by l.card_id
  ),
  tot as (select greatest(1, count(distinct owner_id)) as players from user_cards)
  select coalesce(jsonb_object_agg(ids.card_id, jsonb_build_object(
      'copies', coalesce(own.copies, 0), 'owners', coalesce(own.owners, 0), 'players', (select players from tot),
      'sales', coalesce(sold.sales, 0), 'median', round(sold.median), 'last', sold.last_price,
      'active', coalesce(act.active, 0), 'lowestBn', act.lowest_bn, 'lowestBid', act.lowest_bid,
      'bids', coalesce(bids.bids, 0))), '{}'::jsonb)
  from ids
  left join own using (card_id) left join sold using (card_id) left join act using (card_id) left join bids using (card_id)
$$;

revoke execute on function public.market_card_stats(bigint[]) from public, anon;
grant execute on function public.market_card_stats(bigint[]) to authenticated;
revoke execute on function public.create_listing(uuid, bigint, bigint, int), public.place_bid(uuid, bigint), public.buy_now(uuid) from public, anon;
grant execute on function public.create_listing(uuid, bigint, bigint, int), public.place_bid(uuid, bigint), public.buy_now(uuid) to authenticated;
