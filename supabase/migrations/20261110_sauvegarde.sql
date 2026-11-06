-- =============================================================================
-- FootX TCG — SAUVEGARDE EN LIGNE
-- Dépend de toutes les migrations précédentes (20261104 → 20261109).
-- À exécuter dans Supabase > SQL Editor, AVANT de déployer le site.
--
-- Ce qui passe côté serveur (le navigateur ne garde plus qu'une copie de cache) :
--   1. Profil créé automatiquement à la connexion Discord (+ rattrapage des comptes existants)
--   2. Pack de bienvenue : 10 boosters + 10 cartes
--   3. Stock de boosters (1 toutes les 10 min, 10 max) et garanties (pity) sur le serveur
--   4. Ouverture de booster TIRÉE PAR LE SERVEUR : raretés, cartes, insertion dans user_cards
--   5. Match contre l'IA : début/fin enregistrés, X-Coins + booster de victoire + série
--   6. Équipe (5 titulaires) : seulement des cartes possédées
--   7. Ligue : ligue, journées, composition verrouillée avant vendredi 19:00
--   8. Mode Carrière (solo, sans argent ni cartes) : sauvegarde de la partie
--   9. Corrections : raretés écrites avec accents/majuscules, cartes vendues qui
--      restaient bloquées par une ancienne annonce ou une ancienne compo
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. OUTILS
-- -----------------------------------------------------------------------------
-- "Légendaire", "LEGENDAIRE", " legendaire " → 'legendaire'
create or replace function public._rkey(r text) returns text
language sql immutable as $$
  select case
    when x like 'icon%' then 'iconique'
    when x like 'leg%'  then 'legendaire'
    when x like 'epi%'  then 'epique'
    when x like 'rar%'  then 'rare'
    when x like 'aty%'  then 'atypique'
    else 'commune' end
  from (select lower(translate(btrim(coalesce(r, '')), 'ÉÈÊËéèêëÍÎÏíîïÓÔÖóôöÚÛÜúûü', 'EEEEeeeeIIIiiiOOOoooUUUuuu')) as x) s
$$;

-- rang 0 (commune) → 5 (iconique)
create or replace function public._rrank(r text) returns int
language sql immutable as $$
  select coalesce(array_position(array['commune','atypique','rare','epique','legendaire','iconique'], public._rkey(r)) - 1, 0)
$$;

-- Réglages ajoutés (modifiables dans la table economy_settings, sans toucher au code)
alter table public.economy_settings add column if not exists booster_max       int not null default 10;
alter table public.economy_settings add column if not exists booster_start     int not null default 10;
alter table public.economy_settings add column if not exists booster_regen_min int not null default 10;
alter table public.economy_settings add column if not exists pity_iconic       int not null default 200;
alter table public.economy_settings add column if not exists pity_epic         int not null default 20;
alter table public.economy_settings add column if not exists win_boosters_day  int not null default 5;
alter table public.economy_settings add column if not exists ai_min_seconds    int not null default 40;
alter table public.economy_settings add column if not exists welcome_cards     int not null default 10;

-- Taux de drop (mêmes valeurs que src/lib/drops.js). Lisibles par tous.
create table if not exists public.economy_drop_rates (
  slot   text not null check (slot in ('featured', 'filler')),
  rarity text not null references public.economy_rarity(rarity),
  rate   numeric not null check (rate >= 0),
  primary key (slot, rarity)
);
insert into public.economy_drop_rates values
  ('featured', 'iconique', 0.01), ('featured', 'legendaire', 0.10), ('featured', 'epique', 0.15), ('featured', 'rare', 0.74),
  ('filler', 'commune', 0.62), ('filler', 'atypique', 0.28), ('filler', 'rare', 0.10)
on conflict (slot, rarity) do nothing;
alter table public.economy_drop_rates enable row level security;
drop policy if exists "taux publics" on public.economy_drop_rates;
create policy "taux publics" on public.economy_drop_rates for select using (true);
revoke insert, update, delete on public.economy_drop_rates from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. PROFIL CRÉÉ À LA CONNEXION
-- -----------------------------------------------------------------------------
create or replace function public._username_of(meta jsonb, email text) returns text
language sql immutable as $$
  select left(coalesce(
    nullif(btrim(meta -> 'custom_claims' ->> 'global_name'), ''),
    nullif(btrim(meta ->> 'full_name'), ''),
    nullif(btrim(meta ->> 'name'), ''),
    nullif(btrim(meta ->> 'user_name'), ''),
    nullif(split_part(coalesce(email, ''), '@', 1), ''),
    'Joueur'), 32)
$$;

create or replace function public._handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into profiles(id, username, avatar_url)
      values (new.id, _username_of(new.raw_user_meta_data, new.email), new.raw_user_meta_data ->> 'avatar_url')
      on conflict (id) do nothing;
  exception when others then
    -- ne JAMAIS bloquer la connexion Discord : le profil sera créé à la première action (_ensure_profile)
    raise warning 'FootX : profil non créé pour % (%)', new.id, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public._handle_new_user();

-- Filet de sécurité appelé par chaque action : crée le profil s'il manque encore.
create or replace function public._ensure_profile(p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_uid is null then raise exception 'Non connecté' using hint = 'auth'; end if;
  if exists (select 1 from profiles where id = p_uid) then return; end if;
  insert into profiles(id, username, avatar_url)
    select u.id, _username_of(u.raw_user_meta_data, u.email), u.raw_user_meta_data ->> 'avatar_url'
    from auth.users u where u.id = p_uid
    on conflict (id) do nothing;
  if not exists (select 1 from profiles where id = p_uid) then raise exception 'Compte introuvable' using hint = 'auth'; end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. STOCK DE BOOSTERS (recharge calculée à l'heure du serveur)
-- -----------------------------------------------------------------------------
alter table public.user_boosters alter column stock set default 10;
alter table public.user_boosters add column if not exists regen_at     timestamptz;          -- début du chrono de recharge (null = stock plein)
alter table public.user_boosters add column if not exists pity_iconic  int not null default 0; -- boosters depuis la dernière Iconique
alter table public.user_boosters add column if not exists pity_epic    int not null default 0; -- boosters depuis la dernière Épique ou mieux
alter table public.user_boosters add column if not exists opened       int not null default 0; -- boosters ouverts au total
alter table public.user_boosters add column if not exists win_day      date;                 -- boosters gagnés en Arène : jour…
alter table public.user_boosters add column if not exists win_boosters int not null default 0; -- …et nombre ce jour-là

-- Ligne du joueur, verrouillée, avec la recharge appliquée.
create or replace function public._booster_row(p_user uuid) returns public.user_boosters
language plpgsql security definer set search_path = public as $$
declare b user_boosters; s economy_settings; v_period interval; v_gain int;
begin
  select * into s from economy_settings;
  insert into user_boosters(user_id, stock) values (p_user, s.booster_start) on conflict (user_id) do nothing;
  select * into b from user_boosters where user_id = p_user for update;
  v_period := make_interval(mins => s.booster_regen_min);
  if b.stock >= s.booster_max then
    if b.regen_at is not null then
      update user_boosters set regen_at = null where user_id = p_user;
      b.regen_at := null;
    end if;
  elsif b.regen_at is null then
    update user_boosters set regen_at = now() where user_id = p_user;
    b.regen_at := now();
  else
    v_gain := floor(extract(epoch from now() - b.regen_at) / extract(epoch from v_period));
    if v_gain > 0 then
      b.stock := least(s.booster_max, b.stock + v_gain);
      b.regen_at := case when b.stock >= s.booster_max then null else b.regen_at + v_gain * v_period end;
      update user_boosters set stock = b.stock, regen_at = b.regen_at where user_id = p_user;
    end if;
  end if;
  return b;
end $$;

-- Change le stock en gardant le chrono juste (dépenser un stock plein lance le chrono).
create or replace function public._set_stock(p_user uuid, p_old public.user_boosters, p_new int) returns void
language plpgsql security definer set search_path = public as $$
declare s economy_settings;
begin
  select * into s from economy_settings;
  update user_boosters set
    stock = greatest(0, least(s.booster_max, p_new)),
    regen_at = case when p_new >= s.booster_max then null
                    when p_old.stock >= s.booster_max then now()
                    else coalesce(p_old.regen_at, now()) end
  where user_id = p_user;
end $$;

create or replace function public._booster_json(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b user_boosters; s economy_settings; v_today date := (now() at time zone 'Europe/Paris')::date;
begin
  select * into s from economy_settings;
  select * into b from user_boosters where user_id = p_user;
  return jsonb_build_object(
    'stock', coalesce(b.stock, 0), 'max', s.booster_max,
    'regen_at', b.regen_at, 'regen_ms', s.booster_regen_min * 60000, 'server_now', now(),
    'pity', jsonb_build_object('sinceIconic', coalesce(b.pity_iconic, 0), 'sinceEpic', coalesce(b.pity_epic, 0)),
    'opened', coalesce(b.opened, 0),
    'win_today', case when b.win_day = v_today then b.win_boosters else 0 end, 'win_max', s.win_boosters_day);
end $$;

create or replace function public.booster_state() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _ensure_profile(auth.uid());
  perform _booster_row(auth.uid());
  return _booster_json(auth.uid());
end $$;

-- Achat de boosters : même règle qu'avant, avec la recharge et sans double ajout si la requête est rejouée.
create or replace function public.buy_boosters(p_n int, p_request_id text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); b user_boosters; s economy_settings; v_bal bigint; v_key text;
begin
  perform _ensure_profile(v_uid);
  if p_n is null or p_n not between 1 and 10 then raise exception 'Quantité invalide' using hint = 'invalid'; end if;
  select * into s from economy_settings;
  b := _booster_row(v_uid);
  v_key := 'booster:' || v_uid || ':' || coalesce(p_request_id, gen_random_uuid()::text);
  if exists (select 1 from transactions_history where idempotency_key = v_key) then
    select balance into v_bal from user_balances where user_id = v_uid;
    return v_bal;
  end if;
  if b.stock + p_n > s.booster_max then
    raise exception 'Stock plein (% boosters max)', s.booster_max using hint = 'stock_full';   -- refusé AVANT de débiter
  end if;
  v_bal := _move_coins(v_uid, -(p_n * s.booster_price), 'booster', p_n::text, v_key);
  perform _set_stock(v_uid, b, b.stock + p_n);
  return v_bal;
end $$;

-- -----------------------------------------------------------------------------
-- 3. PACK DE BIENVENUE (nouveau profil)
-- -----------------------------------------------------------------------------
create or replace function public._welcome_pack() returns trigger
language plpgsql security definer set search_path = public as $$
declare s economy_settings;
begin
  select * into s from economy_settings;
  insert into user_boosters(user_id, stock) values (new.id, s.booster_start) on conflict (user_id) do nothing;
  insert into user_cards(owner_id, card_id, source)
    select new.id, c.id, 'reward' from cards c order by random() limit s.welcome_cards;
  return new;
end $$;
drop trigger if exists profiles_welcome_pack on public.profiles;
create trigger profiles_welcome_pack after insert on public.profiles for each row execute function public._welcome_pack();

-- Rattrapage : les comptes Discord déjà inscrits reçoivent leur profil (et donc solde + pack).
insert into public.profiles(id, username, avatar_url)
  select u.id, public._username_of(u.raw_user_meta_data, u.email), u.raw_user_meta_data ->> 'avatar_url'
  from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 4. OUVERTURE DE BOOSTER (tirage serveur, mêmes règles que src/lib/drops.js)
-- -----------------------------------------------------------------------------
-- Une rareté au hasard selon les taux (p_min : rang minimum, pour la garantie Épique+)
create or replace function public._roll(p_slot text, p_min int default 0) returns text
language plpgsql volatile security definer set search_path = public as $$
declare v_tot numeric; v_x numeric; r record; v_last text;
begin
  select sum(rate) into v_tot from economy_drop_rates where slot = p_slot and _rrank(rarity) >= p_min;
  v_x := random() * v_tot;
  for r in select rarity, rate from economy_drop_rates where slot = p_slot and _rrank(rarity) >= p_min order by _rrank(rarity) desc loop
    v_last := r.rarity;
    v_x := v_x - r.rate;
    if v_x < 0 then return r.rarity; end if;
  end loop;
  return v_last;
end $$;

-- Une carte de la rareté demandée. S'il n'y en a pas, on DESCEND d'un cran (jamais vers le haut).
create or replace function public._pick_card(p_pools jsonb, p_rarity text) returns bigint
language plpgsql volatile as $$
declare v_order text[] := array['commune','atypique','rare','epique','legendaire','iconique'];
  i int := public._rrank(p_rarity); j int; k text; arr jsonb;
begin
  for j in reverse i + 1 .. 1 loop
    arr := p_pools -> v_order[j];
    if arr is not null and jsonb_array_length(arr) > 0 then
      return (arr ->> floor(random() * jsonb_array_length(arr))::int)::bigint;
    end if;
  end loop;
  for j in i + 2 .. 6 loop
    arr := p_pools -> v_order[j];
    if arr is not null and jsonb_array_length(arr) > 0 then
      return (arr ->> floor(random() * jsonb_array_length(arr))::int)::bigint;
    end if;
  end loop;
  raise exception 'Aucune carte dans le catalogue' using hint = 'empty_catalogue';
end $$;

-- Historique des ouvertures (sert aussi à rejouer la même requête sans retirer 2 fois)
create table if not exists public.booster_openings (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  request_id text not null,
  n          int  not null,
  cards      jsonb not null,
  forced     jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);
alter table public.booster_openings enable row level security;
drop policy if exists "mes ouvertures" on public.booster_openings;
create policy "mes ouvertures" on public.booster_openings for select using (user_id = auth.uid());
revoke insert, update, delete on public.booster_openings from anon, authenticated;

create or replace function public.open_boosters(p_n int, p_request_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); s economy_settings; b user_boosters; o booster_openings;
  v_pools jsonb; v_si int; v_se int; v_feat text; v_forced text; v_rar text; v_cid bigint; v_uc uuid;
  v_cards jsonb := '[]'::jsonb; v_forced_list jsonb := '[]'::jsonb; i int; j int;
begin
  perform _ensure_profile(v_uid);
  if p_n is null or p_n not between 1 and 10 then raise exception 'Quantité invalide' using hint = 'invalid'; end if;
  if p_request_id is null or char_length(p_request_id) not between 4 and 80 then raise exception 'Requête invalide' using hint = 'invalid'; end if;
  select * into s from economy_settings;
  b := _booster_row(v_uid);                                     -- verrou : un seul tirage à la fois par joueur

  select * into o from booster_openings where user_id = v_uid and request_id = p_request_id;
  if o.id is not null then                                      -- requête rejouée (réseau coupé…) : même résultat
    return jsonb_build_object('cards', o.cards, 'forced', o.forced, 'replay', true, 'state', _booster_json(v_uid));
  end if;
  if b.stock < p_n then raise exception 'Pas assez de boosters (% disponibles)', b.stock using hint = 'no_stock'; end if;

  select jsonb_object_agg(k, ids) into v_pools
    from (select _rkey(rarity) as k, jsonb_agg(id) as ids from cards group by 1) t;
  if v_pools is null then raise exception 'Aucune carte dans le catalogue' using hint = 'empty_catalogue'; end if;

  v_si := b.pity_iconic; v_se := b.pity_epic;
  for i in 1 .. p_n loop
    v_si := v_si + 1; v_se := v_se + 1;
    v_feat := _roll('featured'); v_forced := null;
    if v_feat <> 'iconique' and v_si >= s.pity_iconic then
      v_feat := 'iconique'; v_forced := 'iconique';
    elsif _rrank(v_feat) < 3 and v_se >= s.pity_epic then
      v_feat := _roll('featured', 3); v_forced := 'epicPlus';
    end if;
    if v_feat = 'iconique' then v_si := 0; end if;
    if _rrank(v_feat) >= 3 then v_se := 0; end if;
    v_forced_list := v_forced_list || jsonb_build_array(v_forced);
    for j in 1 .. 10 loop
      v_rar := case when j = 1 then v_feat else _roll('filler') end;
      v_cid := _pick_card(v_pools, v_rar);
      insert into user_cards(owner_id, card_id, source) values (v_uid, v_cid, 'pack') returning id into v_uc;
      v_cards := v_cards || jsonb_build_array(jsonb_build_object('uid', v_uc, 'pack', i,
        'card', (select to_jsonb(c) from cards c where c.id = v_cid)));
    end loop;
  end loop;

  perform _set_stock(v_uid, b, b.stock - p_n);
  update user_boosters set pity_iconic = v_si, pity_epic = v_se, opened = opened + p_n where user_id = v_uid;
  insert into booster_openings(user_id, request_id, n, cards, forced) values (v_uid, p_request_id, p_n, v_cards, v_forced_list);
  perform record_event(v_uid, 'booster_opened', p_n, '{}'::jsonb);   -- défis "Ouvre 1 booster"…
  return jsonb_build_object('cards', v_cards, 'forced', v_forced_list, 'replay', false, 'state', _booster_json(v_uid));
end $$;

-- -----------------------------------------------------------------------------
-- 5. MATCH CONTRE L'IA : enregistré, récompensé une seule fois, plafonné par jour
-- -----------------------------------------------------------------------------
alter table public.arena_matches add column if not exists reward jsonb;

create or replace function public.arena_ai_start(p_squad jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_seed bigint;
begin
  perform _ensure_profile(v_uid);
  if p_squad is null or jsonb_typeof(p_squad) <> 'object' or pg_column_size(p_squad) > 20000 then p_squad := '{}'::jsonb; end if;
  -- un seul match contre l'IA en cours : l'ancien (onglet fermé, abandon) est annulé
  update arena_matches set status = 'abandoned', finished_at = now()
    where home_id = v_uid and away_id is null and status in ('waiting', 'live');
  insert into arena_matches(home_id, away_id, seed, home_squad, away_squad, status)
    values (v_uid, null, floor(random() * 2147483647)::bigint, p_squad, '{}'::jsonb, 'live')
    returning id, seed into v_id, v_seed;
  return jsonb_build_object('id', v_id, 'seed', v_seed);
end $$;

create or replace function public.arena_ai_finish(p_match uuid, p_win boolean, p_home int, p_away int,
  p_perfect int default 0, p_goals jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); m arena_matches; s economy_settings; b user_boosters;
  v_h int; v_a int; v_log jsonb; v_streak int; v_today date := (now() at time zone 'Europe/Paris')::date;
  v_n int; v_coins bigint := 0; v_capped boolean := false; v_booster boolean := false; v_full boolean := false;
  v_left int; v_wins int; v_reward jsonb;
begin
  perform _ensure_profile(v_uid);
  select * into s from economy_settings;
  select * into m from arena_matches where id = p_match for update;
  if m.id is null or m.home_id <> v_uid or m.away_id is not null then raise exception 'Match introuvable' using hint = 'not_found'; end if;
  if m.status = 'finished' and m.reward is not null then return m.reward || jsonb_build_object('replay', true); end if;
  if m.status <> 'live' then raise exception 'Ce match a été annulé' using hint = 'closed'; end if;
  if now() - m.created_at < make_interval(secs => s.ai_min_seconds) then raise exception 'Match trop court' using hint = 'too_fast'; end if;
  if now() - m.created_at > interval '2 hours' then
    update arena_matches set status = 'abandoned', finished_at = now() where id = p_match;
    raise exception 'Match expiré' using hint = 'closed';
  end if;

  v_h := least(greatest(coalesce(p_home, 0), 0), 30);
  v_a := least(greatest(coalesce(p_away, 0), 0), 30);
  select coalesce(jsonb_agg(jsonb_build_object('side', 'home', 'country', left(g ->> 'country', 60), 'club', left(g ->> 'club', 80))), '[]'::jsonb)
    into v_log
    from (select g from jsonb_array_elements(case when jsonb_typeof(p_goals) = 'array' then p_goals else '[]'::jsonb end) g limit v_h) t;

  update arena_matches set status = 'finished', home_score = v_h, away_score = v_a,
    winner_id = case when p_win then v_uid end,
    perfect_qte = jsonb_build_object('home', least(greatest(coalesce(p_perfect, 0), 0), 12)),
    goal_log = v_log, finished_at = now()
    where id = p_match;                                               -- → défis (matchs, victoires, buts…)

  update profiles set win_streak = case when p_win then win_streak + 1 else 0 end where id = v_uid returning win_streak into v_streak;

  -- X-Coins : victoire / défaite, N matchs récompensés par jour
  select count(*) into v_n from transactions_history
    where user_id = v_uid and kind = 'match_reward' and created_at >= (v_today::timestamp at time zone 'Europe/Paris');
  if v_n < s.match_daily_cap then
    v_coins := case when p_win then s.match_win else s.match_loss end;
    perform _move_coins(v_uid, v_coins, 'match_reward', p_match::text, 'match:' || p_match || ':' || v_uid);
  else
    v_capped := true;
  end if;

  -- Victoire = +1 booster (5 par jour, sans dépasser le stock maximum)
  if p_win then
    b := _booster_row(v_uid);
    v_wins := case when b.win_day = v_today then b.win_boosters else 0 end;
    if v_wins >= s.win_boosters_day then
      v_left := 0;
    elsif b.stock >= s.booster_max then
      v_full := true; v_left := s.win_boosters_day - v_wins;
    else
      perform _set_stock(v_uid, b, b.stock + 1);
      update user_boosters set win_day = v_today, win_boosters = v_wins + 1 where user_id = v_uid;
      v_booster := true; v_left := s.win_boosters_day - v_wins - 1;
    end if;
  end if;

  v_reward := jsonb_build_object('coins', v_coins, 'capped', v_capped, 'booster', v_booster, 'full', v_full,
    'left', v_left, 'streak', v_streak, 'state', _booster_json(v_uid));
  update arena_matches set reward = v_reward where id = p_match;
  return v_reward;
end $$;

-- -----------------------------------------------------------------------------
-- 6. ÉQUIPE (5 titulaires, uniquement des cartes possédées)
-- -----------------------------------------------------------------------------
alter table public.squads add column if not exists cards jsonb not null default '{}'::jsonb;  -- {"GK": id_carte, …}
revoke insert, update, delete on public.squads from anon, authenticated;                       -- écriture via squad_save()

create or replace function public._squad_json(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(e.key, to_jsonb(c)), '{}'::jsonb)
  from squads sq
  cross join lateral jsonb_each_text(sq.cards) e
  join cards c on c.id = e.value::bigint
  where sq.owner_id = p_user
    and exists (select 1 from user_cards uc where uc.owner_id = p_user and uc.card_id = c.id)
$$;

create or replace function public.squad_save(p_team jsonb, p_chem int default 0, p_chem_total int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); k text; v text; v_out jsonb := '{}'::jsonb; v_seen bigint[] := '{}';
begin
  perform _ensure_profile(v_uid);
  if p_team is null or jsonb_typeof(p_team) <> 'object' then p_team := '{}'::jsonb; end if;
  foreach k in array array['GK','D1','D2','A1','A2'] loop
    v := p_team ->> k;
    if v is null or v = '' then continue; end if;
    if v !~ '^[0-9]{1,18}$' then raise exception 'Carte invalide' using hint = 'invalid'; end if;
    if v::bigint = any(v_seen) then raise exception 'Une carte ne peut jouer qu''à un seul poste' using hint = 'invalid'; end if;
    if not exists (select 1 from user_cards where owner_id = v_uid and card_id = v::bigint) then
      raise exception 'Tu ne possèdes pas cette carte' using hint = 'not_owner';
    end if;
    v_seen := v_seen || v::bigint;
    v_out := v_out || jsonb_build_object(k, v::bigint);
  end loop;
  insert into squads(owner_id, cards, updated_at) values (v_uid, v_out, now())
    on conflict (owner_id) do update set cards = excluded.cards, updated_at = now();
  -- défis "collectif" (valeurs bornées)
  if p_chem between 1 and 3 then perform record_event(v_uid, 'team_chem', p_chem, '{}'::jsonb); end if;
  if cardinality(v_seen) = 5 and p_chem_total between 1 and 15 then perform record_event(v_uid, 'team_chem_total', p_chem_total, '{}'::jsonb); end if;
  return _squad_json(v_uid);
end $$;

-- -----------------------------------------------------------------------------
-- 7. LIGUE
-- -----------------------------------------------------------------------------
-- Une carte vendue ne doit pas rester bloquée par une ancienne compo ou une ancienne annonce.
alter table public.lineup_cards add column if not exists card_id bigint;
update public.lineup_cards lc set card_id = uc.card_id from public.user_cards uc where uc.id = lc.user_card_id and lc.card_id is null;
do $$
declare r record;
begin
  for r in select con.conname, rel.relname from pg_constraint con
           join pg_class rel on rel.oid = con.conrelid
           where con.contype = 'f' and con.confrelid = 'public.user_cards'::regclass
             and rel.relname in ('lineup_cards', 'market_listings', 'squads') loop
    execute format('alter table public.%I drop constraint %I', r.relname, r.conname);
  end loop;
end $$;
alter table public.lineup_cards    alter column user_card_id drop not null;
alter table public.market_listings alter column user_card_id drop not null;
alter table public.lineup_cards    add constraint lineup_cards_user_card_fk    foreign key (user_card_id) references public.user_cards(id) on delete set null;
alter table public.market_listings add constraint market_listings_user_card_fk foreign key (user_card_id) references public.user_cards(id) on delete set null;
alter table public.squads add constraint squads_gk_fk foreign key (gk) references public.user_cards(id) on delete set null;
alter table public.squads add constraint squads_d1_fk foreign key (d1) references public.user_cards(id) on delete set null;
alter table public.squads add constraint squads_d2_fk foreign key (d2) references public.user_cards(id) on delete set null;
alter table public.squads add constraint squads_a1_fk foreign key (a1) references public.user_cards(id) on delete set null;
alter table public.squads add constraint squads_a2_fk foreign key (a2) references public.user_cards(id) on delete set null;

-- Journée à composer : verrouillage le prochain vendredi 19:00 (heure de Paris).
-- Même calcul que gameweekInfo() dans src/lib/league/scoring.js (saison lancée le vendredi 14 août 2026).
create or replace function public._gw_current() returns public.gameweeks
language plpgsql security definer set search_path = public as $$
declare v_local timestamp := now() at time zone 'Europe/Paris'; v_fri timestamp; v_deadline timestamptz; v_num int; g gameweeks;
begin
  v_fri := date_trunc('week', v_local) + interval '4 days 19 hours';            -- lundi + 4 j = vendredi
  if v_fri <= v_local then v_fri := v_fri + interval '7 days'; end if;
  v_deadline := v_fri at time zone 'Europe/Paris';
  v_num := greatest(1, round(extract(epoch from v_deadline - (timestamp '2026-08-14 19:00' at time zone 'Europe/Paris')) / 604800)::int + 1);
  insert into gameweeks(season, number, deadline, ends_at)
    values (1, v_num, v_deadline, ((v_fri + interval '3 days')::date + time '23:00') at time zone 'Europe/Paris')
    on conflict (season, number) do nothing;
  select * into g from gameweeks where season = 1 and number = v_num;
  return g;
end $$;

create or replace function public._my_league(p_user uuid) returns public.leagues
language plpgsql security definer set search_path = public as $$
declare l leagues;
begin
  select lg.* into l from leagues lg join league_members m on m.league_id = lg.id
    where m.user_id = p_user order by m.joined_at desc limit 1;
  if l.id is null then
    insert into leagues(name, owner_id) values ('Ligue des potes', p_user) returning * into l;   -- le créateur devient membre (trigger)
  end if;
  return l;
end $$;

create or replace function public._lineup_json(p_user uuid, p_number int) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gw', g.number, 'captain', lu.captain_slot, 'lockedAt', floor(extract(epoch from lu.locked_at) * 1000),
    'team', coalesce((select jsonb_object_agg(lc.slot, to_jsonb(c)) from lineup_cards lc join cards c on c.id = lc.card_id
                      where lc.user_id = lu.user_id and lc.gameweek_id = lu.gameweek_id), '{}'::jsonb))
  from lineups lu join gameweeks g on g.id = lu.gameweek_id
  where lu.user_id = p_user and g.season = 1 and g.number = p_number
$$;

-- p_gw : numéro de la journée affichée (pendant le week-end, c'est la précédente)
create or replace function public.league_get(p_gw int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); l leagues; g gameweeks;
begin
  perform _ensure_profile(v_uid);
  l := _my_league(v_uid);
  g := _gw_current();
  return jsonb_build_object(
    'league', jsonb_build_object('id', l.id, 'name', l.name, 'code', l.invite_code, 'owner', l.owner_id = v_uid,
      'members', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.username, 'avatar', p.avatar_url, 'me', p.id = v_uid,
                    'points', coalesce((select sum(lu.total_points) from lineups lu join gameweeks gw on gw.id = lu.gameweek_id
                                        where lu.user_id = p.id and gw.season = l.season), 0),
                    'locked', exists (select 1 from lineups lu where lu.user_id = p.id and lu.gameweek_id = g.id))
                  order by p.username), '[]'::jsonb)
                  from league_members m join profiles p on p.id = m.user_id where m.league_id = l.id)),
    'gameweek', jsonb_build_object('number', g.number, 'deadline', g.deadline),
    'lock', _lineup_json(v_uid, coalesce(p_gw, g.number)));
end $$;

create or replace function public.league_lock(p_team jsonb, p_captain text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); g gameweeks; k text; v text; v_seen bigint[] := '{}'; v_uc uuid;
begin
  perform _ensure_profile(v_uid);
  g := _gw_current();
  if now() >= g.deadline then raise exception 'Les compositions sont verrouillées' using hint = 'closed'; end if;
  if p_captain is null or p_captain not in ('GK','D1','D2','A1','A2') then raise exception 'Choisis un capitaine' using hint = 'invalid'; end if;
  foreach k in array array['GK','D1','D2','A1','A2'] loop
    v := p_team ->> k;
    if v is null or v !~ '^[0-9]{1,18}$' then raise exception 'Il manque un titulaire' using hint = 'invalid'; end if;
    if v::bigint = any(v_seen) then raise exception 'Une carte ne peut jouer qu''à un seul poste' using hint = 'invalid'; end if;
    if not exists (select 1 from user_cards where owner_id = v_uid and card_id = v::bigint) then
      raise exception 'Tu ne possèdes pas cette carte' using hint = 'not_owner';
    end if;
    v_seen := v_seen || v::bigint;
  end loop;
  delete from lineups where user_id = v_uid and gameweek_id = g.id;          -- re-verrouiller remplace l'ancienne compo
  insert into lineups(user_id, gameweek_id, captain_slot) values (v_uid, g.id, p_captain);
  foreach k in array array['GK','D1','D2','A1','A2'] loop
    v := p_team ->> k;
    select uc.id into v_uc from user_cards uc where uc.owner_id = v_uid and uc.card_id = v::bigint
      order by (uc.listing_id is null) desc, uc.obtained_at limit 1;
    insert into lineup_cards(user_id, gameweek_id, slot, user_card_id, card_id, rarity)
      select v_uid, g.id, k, v_uc, c.id, _rkey(c.rarity) from cards c where c.id = v::bigint;
  end loop;
  return _lineup_json(v_uid, g.number);
end $$;

create or replace function public.league_unlock()
returns boolean language plpgsql security definer set search_path = public as $$
declare g gameweeks;
begin
  perform _ensure_profile(auth.uid());
  g := _gw_current();
  if now() >= g.deadline then raise exception 'Les compositions sont verrouillées' using hint = 'closed'; end if;
  delete from lineups where user_id = auth.uid() and gameweek_id = g.id;
  return true;
end $$;

create or replace function public.league_rename(p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare l leagues; v_name text := left(btrim(coalesce(p_name, '')), 32);
begin
  perform _ensure_profile(auth.uid());
  l := _my_league(auth.uid());
  if l.owner_id <> auth.uid() then raise exception 'Seul le créateur de la ligue peut la renommer' using hint = 'forbidden'; end if;
  if char_length(v_name) < 2 then v_name := 'Ma ligue'; end if;
  update leagues set name = v_name where id = l.id;
  return v_name;
end $$;

-- Rejoindre la ligue d'un ami avec son code (elle devient ta ligue affichée).
create or replace function public.league_join(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_lid uuid;
begin
  perform _ensure_profile(v_uid);
  select id into v_lid from leagues where invite_code = upper(btrim(coalesce(p_code, '')));
  if v_lid is null then raise exception 'Code de ligue inconnu' using hint = 'not_found'; end if;
  if (select count(*) from league_members where league_id = v_lid) >= 20 and not exists (select 1 from league_members where league_id = v_lid and user_id = v_uid) then
    raise exception 'Cette ligue est complète (20 joueurs)' using hint = 'full';
  end if;
  insert into league_members(league_id, user_id) values (v_lid, v_uid)
    on conflict (league_id, user_id) do update set joined_at = now();    -- devient la ligue affichée
  return league_get(null);
end $$;

-- -----------------------------------------------------------------------------
-- 8. MODE CARRIÈRE (solo : ni X-Coins ni cartes) — sauvegarde de la partie
-- -----------------------------------------------------------------------------
create table if not exists public.user_saves (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  slot       text not null check (slot in ('career', 'legend', 'prefs')),
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);
alter table public.user_saves enable row level security;
drop policy if exists "mes sauvegardes" on public.user_saves;
create policy "mes sauvegardes" on public.user_saves for select using (user_id = auth.uid());
revoke insert, update, delete on public.user_saves from anon, authenticated;

create or replace function public.save_put(p_slot text, p_data jsonb)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_at timestamptz;
begin
  perform _ensure_profile(auth.uid());
  if p_slot not in ('career', 'legend', 'prefs') then raise exception 'Sauvegarde inconnue' using hint = 'invalid'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Sauvegarde invalide' using hint = 'invalid'; end if;
  if pg_column_size(p_data) > 262144 then raise exception 'Sauvegarde trop lourde' using hint = 'too_big'; end if;
  insert into user_saves(user_id, slot, data, updated_at) values (auth.uid(), p_slot, p_data, now())
    on conflict (user_id, slot) do update set data = excluded.data, updated_at = now()
    returning updated_at into v_at;
  return v_at;
end $$;

-- -----------------------------------------------------------------------------
-- 9. CHARGEMENT EN UN SEUL APPEL (au démarrage du site)
-- -----------------------------------------------------------------------------
create or replace function public.me_bootstrap()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); p profiles;
begin
  perform _ensure_profile(v_uid);
  -- avatar Discord à jour (il change quand le joueur le modifie sur Discord)
  update profiles pr set avatar_url = coalesce(u.raw_user_meta_data ->> 'avatar_url', pr.avatar_url), last_seen = now()
    from auth.users u where u.id = v_uid and pr.id = v_uid;
  select * into p from profiles where id = v_uid;
  perform _booster_row(v_uid);
  return jsonb_build_object(
    'profile', jsonb_build_object('id', p.id, 'username', p.username, 'avatar', p.avatar_url, 'streak', p.win_streak),
    'boosters', _booster_json(v_uid),
    'squad', _squad_json(v_uid),
    'saves', (select coalesce(jsonb_object_agg(slot, data), '{}'::jsonb) from user_saves where user_id = v_uid),
    'server_now', now());
end $$;

-- -----------------------------------------------------------------------------
-- 10. RARETÉS : accents et majuscules acceptés partout
-- -----------------------------------------------------------------------------
create or replace function public.quicksell_cards(p_cards uuid[])
returns bigint language plpgsql security definer set search_path = public as $$
declare v_total bigint; v_n int;
begin
  perform _ensure_profile(auth.uid());
  select count(*), coalesce(sum(r.quicksell), 0) into v_n, v_total
    from user_cards uc join cards c on c.id = uc.card_id join economy_rarity r on r.rarity = _rkey(c.rarity)
    where uc.id = any(p_cards) and uc.owner_id = auth.uid() and uc.listing_id is null;
  if v_n <> coalesce(array_length(p_cards, 1), 0) then
    raise exception 'Carte introuvable, déjà vendue ou en vente' using hint = 'not_owner';
  end if;
  delete from user_cards where id = any(p_cards) and owner_id = auth.uid() and listing_id is null;
  return _move_coins(auth.uid(), v_total, 'quicksell', left(array_to_string(p_cards, ','), 500), null);
end $$;

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
    raise exception 'Trop d''annonces actives';
  end if;
  select * into c from cards where id = uc.card_id;
  select * into r from economy_rarity where rarity = _rkey(c.rarity);
  if r.rarity is null or p_start < r.min_price or p_buy_now > r.max_price or p_buy_now <= p_start then
    raise exception 'Prix hors fourchette (% – %)', r.min_price, r.max_price using hint = 'price_range';
  end if;
  insert into market_listings(seller_id, user_card_id, card_id, card_name, rarity, position, club, country, start_price, buy_now_price, ends_at)
    values (auth.uid(), uc.id, c.id, c.name, r.rarity, c.position, c.club, c.country, p_start, p_buy_now, now() + make_interval(hours => p_hours))
    returning id into v_id;
  update user_cards set listing_id = v_id where id = uc.id;
  return v_id;
end $$;

create or replace function public._quests_on_cards() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := coalesce(new.owner_id, old.owner_id); v_ico int; v_leg int;
begin
  select count(*) filter (where _rkey(c.rarity) = 'iconique'), count(*) filter (where _rkey(c.rarity) = 'legendaire')
    into v_ico, v_leg
    from user_cards uc join cards c on c.id = uc.card_id where uc.owner_id = v_owner;
  perform record_event(v_owner, 'collection_iconique', v_ico, '{}'::jsonb);
  perform record_event(v_owner, 'collection_legendaire', v_leg, '{}'::jsonb);
  return null;
end $$;

-- -----------------------------------------------------------------------------
-- 11. DROITS : les fonctions internes ne sont appelables par aucun client
-- -----------------------------------------------------------------------------
revoke execute on function public._handle_new_user(), public._ensure_profile(uuid), public._booster_row(uuid),
  public._set_stock(uuid, public.user_boosters, int), public._booster_json(uuid), public._welcome_pack(),
  public._roll(text, int), public._pick_card(jsonb, text), public._squad_json(uuid), public._gw_current(),
  public._my_league(uuid), public._lineup_json(uuid, int) from public, anon, authenticated;

revoke execute on function public.booster_state(), public.open_boosters(int, text), public.buy_boosters(int, text),
  public.arena_ai_start(jsonb), public.arena_ai_finish(uuid, boolean, int, int, int, jsonb),
  public.squad_save(jsonb, int, int), public.league_get(int), public.league_lock(jsonb, text), public.league_unlock(),
  public.league_rename(text), public.league_join(text), public.save_put(text, jsonb), public.me_bootstrap(),
  public.quicksell_cards(uuid[]), public.create_listing(uuid, bigint, bigint, int) from public, anon;
grant execute on function public.booster_state(), public.open_boosters(int, text), public.buy_boosters(int, text),
  public.arena_ai_start(jsonb), public.arena_ai_finish(uuid, boolean, int, int, int, jsonb),
  public.squad_save(jsonb, int, int), public.league_get(int), public.league_lock(jsonb, text), public.league_unlock(),
  public.league_rename(text), public.league_join(text), public.save_put(text, jsonb), public.me_bootstrap(),
  public.quicksell_cards(uuid[]), public.create_listing(uuid, bigint, bigint, int) to authenticated;

-- Temps réel : le stock de boosters se met à jour sur tous les appareils
do $$ begin
  alter publication supabase_realtime add table public.user_boosters;
exception when duplicate_object then null; end $$;
