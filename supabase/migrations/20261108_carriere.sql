-- =============================================================================
-- FootX TCG — Mode Carrière Solo « L'Ascension »
-- Dépend de 20261104 (profiles, cards). Remplace 20261107_legende.sql :
-- la carte personnalisée ne va plus en multijoueur, elle vit dans ce mode solo.
--
-- Principe (comme l'économie) : le client LIT sa carrière et ne la modifie
-- qu'au travers de fonctions qui vérifient tout. Le mode est solo : un joueur
-- ne peut au pire que tricher sur sa propre progression (aucune pièce, aucune
-- carte n'est gagnée ici), mais les bornes et l'idempotence restent strictes.
--
-- Tables principales :
--   career_save      la sauvegarde (joueur, club actuel, contrat, XP, saison)
--   career_stats     le bilan de chaque saison (matchs, buts, notes)
--   career_skills    l'arbre de compétences débloqué
-- Tables de support :
--   career_fixtures  le calendrier et les résultats (1 ligne = 1 match)
--   career_offers    la boîte de réception (premier contrat, offres du mercato)
--   career_clubs     VUE : les clubs, dérivés de la table cards
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. NETTOYAGE : l'ancienne "Légende" multijoueur (si 20261107 a été appliquée)
-- -----------------------------------------------------------------------------
do $$ begin
  if to_regclass('public.arena_matches') is not null then
    execute 'drop trigger if exists avatar_on_match on public.arena_matches';
  end if;
  if to_regclass('public.squads') is not null then
    execute 'alter table public.squads drop column if exists legend_slot';
  end if;
end $$;
drop function if exists public._avatar_on_match() cascade;
drop function if exists public._grant_avatar_xp(uuid, int, text, text);
drop function if exists public.get_my_avatar();
drop function if exists public.unlock_skill(text);
drop function if exists public.create_avatar(text, int, text, text, jsonb, text);
drop function if exists public._avatar_points(uuid);
drop function if exists public._avatar_level(bigint);
drop table if exists public.avatar_progression, public.avatar_skills, public.user_avatar, public.avatar_skill_nodes, public.avatar_talents cascade;

-- -----------------------------------------------------------------------------
-- 1. RÉFÉRENTIELS (lecture publique ; = src/lib/legend/config.js)
-- -----------------------------------------------------------------------------
create table if not exists public.career_talents (
  id       text primary key,
  label    text not null,
  bonus    jsonb not null default '{}'::jsonb,       -- {"tir":6} …
  xp_bonus numeric not null default 0,              -- 0.1 = +10 % d'XP
  trait    text
);
insert into public.career_talents(id, label, bonus, xp_bonus, trait) values
  ('buteur', 'Instinct du buteur', '{"tir":6}'::jsonb, 0, 'puissance'),
  ('foudre', 'Foudre', '{"vitesse":6}'::jsonb, 0, 'dribbleur'),
  ('rempart', 'Rempart', '{"defense":6}'::jsonb, 0, 'mur'),
  ('maestro', 'Maestro', '{"tir":2,"vitesse":2,"defense":2}'::jsonb, 0.1, 'lecture')
on conflict (id) do update set label = excluded.label, bonus = excluded.bonus, xp_bonus = excluded.xp_bonus, trait = excluded.trait;

create table if not exists public.career_skill_nodes (
  id        text primary key,
  branch    text not null check (branch in ('tir','vitesse','defense')),
  tier      int  not null,
  kind      text not null check (kind in ('stat','trait','mastery','ultimate')),
  stat      text check (stat in ('tir','vitesse','defense')),
  amount    int  not null default 0,
  trait     text,
  ultimate  text,
  cost      int  not null check (cost > 0),
  level_req int  not null default 1,
  requires  text[] not null default '{}',
  max_rank  int  not null default 1 check (max_rank >= 1)
);
insert into public.career_skill_nodes(id, branch, tier, kind, stat, amount, trait, ultimate, cost, level_req, requires, max_rank)
select b || '1', b, 1, 'stat', b, 3, null, null, 1, 1, '{}'::text[], 1 from (values ('tir'), ('vitesse'), ('defense')) v(b)
union all select b || '2', b, 2, 'stat', b, 4, null, null, 1, 4, array[b || '1'], 1 from (values ('tir'), ('vitesse'), ('defense')) v(b)
union all select b || '3', b, 3, 'trait', null, 0, t, null, 2, 8, array[b || '2'], 1 from (values ('tir', 'sangfroid'), ('vitesse', 'dribbleur'), ('defense', 'reflexes')) v(b, t)
union all select b || '4', b, 4, 'stat', b, 5, null, null, 2, 14, array[b || '3'], 1 from (values ('tir'), ('vitesse'), ('defense')) v(b)
union all select b || '5', b, 5, 'mastery', b, 2, null, null, 2, 20, array[b || '4'], 5 from (values ('tir'), ('vitesse'), ('defense')) v(b)
union all select b || 'U', b, 6, 'ultimate', null, 0, null, u, 3, 25, array[b || '4'], 1 from (values ('tir', 'meteore'), ('vitesse', 'eclair'), ('defense', 'fantome')) v(b, u)
on conflict (id) do update set branch = excluded.branch, tier = excluded.tier, kind = excluded.kind, stat = excluded.stat, amount = excluded.amount,
  trait = excluded.trait, ultimate = excluded.ultimate, cost = excluded.cost, level_req = excluded.level_req, requires = excluded.requires, max_rank = excluded.max_rank;

-- -----------------------------------------------------------------------------
-- 2. LES CLUBS : dérivés des cartes (= src/lib/career/clubs.js)
--    force = moyenne des 5 meilleures cartes ; palier 1 Élite ≥ 86, 2 Grand ≥ 80, 3 Ambitieux ≥ 72, 4 Formateur
-- -----------------------------------------------------------------------------
create or replace function public._club_key(p text) returns text
language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(translate(btrim(coalesce(p, '')),
    'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿ', 'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyy')), '[^a-z0-9]+', '-', 'g'))
$$;

create or replace function public._card_rating(p_rarity text) returns int
language sql immutable as $$
  select case public._club_key(p_rarity)
    when 'commune' then 62 when 'atypique' then 70 when 'rare' then 78 when 'epique' then 84
    when 'legendaire' then 89 when 'iconique' then 93 else 65 end
$$;

create or replace view public.career_clubs with (security_invoker = true) as
with c as (
  select _club_key(club) as club_key, btrim(club) as name, country, _card_rating(rarity) as rating,
         row_number() over (partition by _club_key(club) order by _card_rating(rarity) desc, id) as rk
    from public.cards where club is not null and _club_key(club) <> ''
), agg as (
  select club_key, min(name) as name, count(*)::int as n_cards,
         mode() within group (order by country) as country,
         round((coalesce(sum(rating) filter (where rk <= 5), 0) + 60 * greatest(0, 5 - count(*) filter (where rk <= 5))) / 5.0)::int as strength
    from c group by club_key
)
select club_key, name, country, n_cards, strength,
       case when strength >= 86 then 1 when strength >= 80 then 2 when strength >= 72 then 3 else 4 end as tier
  from agg where n_cards >= 3;

-- -----------------------------------------------------------------------------
-- 3. LA CARRIÈRE
-- -----------------------------------------------------------------------------
-- Une sauvegarde par compte. Le niveau se calcule depuis l'XP (impossible à désynchroniser).
create table if not exists public.career_save (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  player_name     text not null check (char_length(btrim(player_name)) between 2 and 16 and player_name !~ '[[:cntrl:]<>]'),
  shirt_number    int  not null default 10 check (shirt_number between 1 and 99),
  position        text not null check (position in ('ATT','MIL','DEF','GB')),
  country         text not null,
  appearance      jsonb not null default '{}'::jsonb check (jsonb_typeof(appearance) = 'object' and pg_column_size(appearance) < 2048),
  talent          text not null references public.career_talents(id),
  xp              bigint not null default 0 check (xp >= 0),
  club_key        text not null,
  club_name       text not null,
  season          int  not null default 1 check (season >= 1),
  phase           text not null default 'season' check (phase in ('season','mercato')),
  contract_until  int  not null,
  wage            int  not null default 0 check (wage >= 0),       -- € / semaine (fictif)
  role            text not null default 'Jeune espoir',
  seed            bigint not null default (floor(random() * 2147483647))::bigint,
  live_fixture    bigint,                                          -- match lancé (anti-triche : pas de résultat sans coup d'envoi)
  live_started_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Arbre de compétences (rank > 1 pour les nœuds "maîtrise" répétables)
create table if not exists public.career_skills (
  user_id     uuid not null references public.career_save(user_id) on delete cascade,
  node_id     text not null references public.career_skill_nodes(id),
  rank        int  not null default 1 check (rank >= 1),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, node_id)
);

-- Bilan de saison (une ligne par saison ; la note moyenne = rating_sum / played)
create table if not exists public.career_stats (
  user_id      uuid not null references public.career_save(user_id) on delete cascade,
  season       int  not null,
  club_key     text not null,
  club_name    text not null,
  played       int  not null default 0 check (played >= 0),
  wins         int  not null default 0 check (wins >= 0),
  goals        int  not null default 0 check (goals >= 0),
  perfect_qte  int  not null default 0 check (perfect_qte >= 0),
  rating_sum   numeric(6,1) not null default 0,
  best_rating  numeric(3,1) not null default 0,
  motm         int  not null default 0,          -- notes ≥ 8 (hommes du match)
  xp           int  not null default 0,
  market_score int,                               -- calculé à la clôture (attire les offres)
  closed_at    timestamptz,
  primary key (user_id, season)
);

-- Calendrier : 10 matchs par saison
create table if not exists public.career_fixtures (
  id         bigserial primary key,
  user_id    uuid not null references public.career_save(user_id) on delete cascade,
  season     int  not null,
  round      int  not null check (round between 1 and 38),
  opp_key    text not null,
  opp_name   text not null,
  is_home    boolean not null,
  big        boolean not null default false,  -- "choc" : affiche dorée
  result     jsonb,                            -- {win, gf, ga, goals, perfect, sim}
  rating     numeric(3,1),
  xp         int,
  played_at  timestamptz,
  unique (user_id, season, round)
);
create index if not exists career_fixtures_user_idx on public.career_fixtures(user_id, season, round);

-- Boîte de réception : premier contrat, prolongation, offres de transfert
create table if not exists public.career_offers (
  id          bigserial primary key,
  user_id     uuid not null references public.career_save(user_id) on delete cascade,
  season      int  not null,
  kind        text not null check (kind in ('debut','renewal','transfer')),
  club_key    text not null,
  club_name   text not null,
  tier        int  not null check (tier between 1 and 4),
  wage        int  not null check (wage >= 0),
  years       int  not null check (years between 1 and 6),
  role        text not null,
  bonus       int  not null default 0,
  status      text not null default 'new' check (status in ('new','read','accepted','declined','expired')),
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists career_offers_user_idx on public.career_offers(user_id, season, status);

-- -----------------------------------------------------------------------------
-- 4. SÉCURITÉ : chacun ne voit que SA carrière, aucune écriture directe
-- -----------------------------------------------------------------------------
alter table public.career_talents     enable row level security;
alter table public.career_skill_nodes enable row level security;
alter table public.career_save        enable row level security;
alter table public.career_skills      enable row level security;
alter table public.career_stats       enable row level security;
alter table public.career_fixtures    enable row level security;
alter table public.career_offers      enable row level security;
drop policy if exists "talents publics" on public.career_talents;
drop policy if exists "arbre public" on public.career_skill_nodes;
drop policy if exists "ma carrière" on public.career_save;
drop policy if exists "mes compétences" on public.career_skills;
drop policy if exists "mes saisons" on public.career_stats;
drop policy if exists "mon calendrier" on public.career_fixtures;
drop policy if exists "mon courrier" on public.career_offers;
create policy "talents publics"  on public.career_talents     for select using (true);
create policy "arbre public"     on public.career_skill_nodes for select using (true);
create policy "ma carrière"      on public.career_save        for select using (user_id = auth.uid());
create policy "mes compétences"  on public.career_skills      for select using (user_id = auth.uid());
create policy "mes saisons"      on public.career_stats       for select using (user_id = auth.uid());
create policy "mon calendrier"   on public.career_fixtures    for select using (user_id = auth.uid());
create policy "mon courrier"     on public.career_offers      for select using (user_id = auth.uid());
revoke insert, update, delete on public.career_talents, public.career_skill_nodes, public.career_save, public.career_skills,
  public.career_stats, public.career_fixtures, public.career_offers from anon, authenticated;
grant select on public.career_clubs to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. RÈGLES (= src/lib/career/rules.js et src/lib/legend/config.js)
-- -----------------------------------------------------------------------------
-- Courbe d'XP : 80 + 25 × (niveau − 1) pour passer au suivant, niveau max 50
create or replace function public._career_level(p_xp bigint) returns int
language plpgsql immutable as $$
declare lv int := 1; rest bigint := greatest(p_xp, 0);
begin
  while lv < 50 and rest >= 80 + 25 * (lv - 1) loop rest := rest - (80 + 25 * (lv - 1)); lv := lv + 1; end loop;
  return lv;
end $$;

create or replace function public._career_points(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select _career_level(s.xp) - coalesce((select sum(n.cost * k.rank) from career_skills k join career_skill_nodes n on n.id = k.node_id where k.user_id = s.user_id), 0)::int
    from career_save s where s.user_id = p_user
$$;

-- Note sur 10 (6 + victoire ± + buts + timings parfaits + lectures − hésitations ; gardien : arrêts − buts encaissés)
create or replace function public._career_rating(p jsonb) returns numeric
language plpgsql immutable as $$
declare r numeric; v_act int := coalesce((p ->> 'actions')::int, 0);
begin
  r := 6 + case when (p ->> 'win')::boolean then 0.5 else -0.4 end
         + coalesce((p ->> 'goals')::int, 0) * 1.0
         + coalesce((p ->> 'perfect')::int, 0) * 0.3
         - coalesce((p ->> 'hesitations')::int, 0) * 0.25;
  if v_act > 0 then r := r + (coalesce((p ->> 'reads')::int, 0)::numeric / v_act - 0.5) * 2; end if;
  if coalesce((p ->> 'keeper')::boolean, false) then
    r := r + coalesce((p ->> 'saves')::int, 0) * 0.35 - coalesce((p ->> 'conceded')::int, 0) * 0.3;
  end if;
  return round(least(10, greatest(3, r)), 1);
end $$;

-- Calendrier d'une saison : 10 adversaires au hasard, le plus fort en dernière journée
create or replace function public._career_make_fixtures(p_user uuid, p_season int) returns int
language plpgsql security definer set search_path = public as $$
declare v_my career_clubs; v_n int;
begin
  select c.* into v_my from career_clubs c join career_save s on s.club_key = c.club_key where s.user_id = p_user;
  with pool as (
    select c.*, row_number() over (order by c.strength desc, random()) as by_strength, random() as r
      from career_clubs c where c.club_key <> coalesce(v_my.club_key, '') order by random() limit 10
  ), ordered as (
    select p.*, row_number() over (order by (p.by_strength = (select min(by_strength) from pool)), p.r) as rnd from pool p
  )
  insert into career_fixtures(user_id, season, round, opp_key, opp_name, is_home, big)
  select p_user, p_season, o.rnd, o.club_key, o.name, o.rnd % 2 = 1, o.tier = 1 or (o.tier <= 2 and coalesce(v_my.tier, 4) <= 2)
    from ordered o
  on conflict (user_id, season, round) do nothing;
  get diagnostics v_n = row_count;
  insert into career_stats(user_id, season, club_key, club_name)
  select p_user, p_season, s.club_key, s.club_name from career_save s where s.user_id = p_user
  on conflict (user_id, season) do nothing;
  return v_n;
end $$;

-- -----------------------------------------------------------------------------
-- 6. ACTIONS DU JOUEUR
-- -----------------------------------------------------------------------------
-- Nouvelle carrière : joueur + club de départ + calendrier + premier contrat à signer
create or replace function public.career_start(p_name text, p_number int, p_position text, p_country text, p_appearance jsonb, p_talent text, p_club_key text)
returns void language plpgsql security definer set search_path = public as $$
declare v_club career_clubs;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if exists (select 1 from career_save where user_id = auth.uid()) then raise exception 'Une carrière est déjà en cours' using hint = 'exists'; end if;
  select * into v_club from career_clubs where club_key = p_club_key;
  if v_club.club_key is null then raise exception 'Club introuvable'; end if;
  insert into career_save(user_id, player_name, shirt_number, position, country, appearance, talent, club_key, club_name, contract_until, wage, role)
  values (auth.uid(), btrim(p_name), p_number, p_position, p_country, coalesce(p_appearance, '{}'::jsonb), p_talent,
          v_club.club_key, v_club.name, 3, (array[22500, 11000, 4500, 1500])[v_club.tier], 'Jeune espoir');
  perform _career_make_fixtures(auth.uid(), 1);
  insert into career_offers(user_id, season, kind, club_key, club_name, tier, wage, years, role)
  values (auth.uid(), 1, 'debut', v_club.club_key, v_club.name, v_club.tier, (array[22500, 11000, 4500, 1500])[v_club.tier], 3, 'Jeune espoir');
end $$;

-- Repartir de zéro (efface tout : saisons, arbre, courrier)
create or replace function public.career_reset() returns void
language sql security definer set search_path = public as $$
  delete from career_save where user_id = auth.uid()
$$;

-- Coup d'envoi : seul le match lancé pourra recevoir un résultat
create or replace function public.career_kickoff(p_fixture bigint) returns void
language plpgsql security definer set search_path = public as $$
declare f career_fixtures; s career_save;
begin
  select * into s from career_save where user_id = auth.uid() for update;
  if s.user_id is null then raise exception 'Aucune carrière'; end if;
  select * into f from career_fixtures where id = p_fixture and user_id = s.user_id;
  if f.id is null or f.result is not null or f.season <> s.season then raise exception 'Match indisponible'; end if;
  if exists (select 1 from career_fixtures where user_id = s.user_id and season = s.season and round < f.round and result is null) then
    raise exception 'Joue d''abord les matchs précédents';
  end if;
  update career_save set live_fixture = f.id, live_started_at = now(), updated_at = now() where user_id = s.user_id;
end $$;

-- (interne) enregistre un résultat, verse l'XP et met à jour le bilan
create or replace function public._career_apply(p_user uuid, p_fixture bigint, p_result jsonb, p_rating numeric, p_sim boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_xp int; v_bonus numeric; v_before int; v_after int; v_goals int := coalesce((p_result ->> 'goals')::int, 0); v_win boolean := (p_result ->> 'win')::boolean;
begin
  select t.xp_bonus, _career_level(s.xp) into v_bonus, v_before from career_save s join career_talents t on t.id = s.talent where s.user_id = p_user;
  v_xp := round((40 + p_rating * 20 + v_goals * 40 + case when v_win then 60 else 0 end) * case when p_sim then 0.5 else 1 end * (1 + v_bonus));
  update career_fixtures set result = p_result || jsonb_build_object('sim', p_sim), rating = p_rating, xp = v_xp, played_at = now() where id = p_fixture;
  update career_save set xp = xp + v_xp, live_fixture = null, live_started_at = null, updated_at = now() where user_id = p_user
    returning _career_level(xp) into v_after;
  update career_stats st set played = played + 1, wins = wins + v_win::int, goals = goals + v_goals,
         perfect_qte = perfect_qte + coalesce((p_result ->> 'perfect')::int, 0), rating_sum = rating_sum + p_rating,
         best_rating = greatest(best_rating, p_rating), motm = motm + (p_rating >= 8)::int, xp = st.xp + v_xp
   where st.user_id = p_user and st.season = (select f.season from career_fixtures f where f.id = p_fixture);
  return jsonb_build_object('rating', p_rating, 'xp', v_xp, 'level', v_after, 'levels', v_after - v_before,
    'season_over', not exists (select 1 from career_fixtures f join career_save s on s.user_id = f.user_id and s.season = f.season where f.user_id = p_user and f.result is null));
end $$;

-- Fin d'un match JOUÉ dans l'Arène : bornes vérifiées, note calculée ICI (le client ne la fournit pas)
create or replace function public.career_report_match(p_fixture bigint, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s career_save; f career_fixtures; v_gf int := (p ->> 'gf')::int; v_ga int := (p ->> 'ga')::int; v_act int := (p ->> 'actions')::int;
begin
  select * into s from career_save where user_id = auth.uid() for update;
  if s.user_id is null then raise exception 'Aucune carrière'; end if;
  select * into f from career_fixtures where id = p_fixture and user_id = s.user_id for update;
  if f.id is null or f.result is not null then raise exception 'Résultat déjà enregistré' using hint = 'done'; end if;
  if s.live_fixture is distinct from f.id then raise exception 'Ce match n''a pas été lancé'; end if;
  if now() - s.live_started_at < interval '40 seconds' then raise exception 'Match trop court'; end if;
  if v_gf is null or v_ga is null or v_gf not between 0 and 15 or v_ga not between 0 and 15
     or coalesce((p ->> 'goals')::int, 0) not between 0 and v_gf
     or v_act is null or v_act not between 1 and 20
     or coalesce((p ->> 'reads')::int, 0) not between 0 and v_act
     or coalesce((p ->> 'perfect')::int, 0) not between 0 and v_act
     or coalesce((p ->> 'hesitations')::int, 0) not between 0 and v_act
     or coalesce((p ->> 'saves')::int, 0) not between 0 and v_act
     or (p ->> 'win') is null or ((p ->> 'win')::boolean and v_gf < v_ga) or (not (p ->> 'win')::boolean and v_gf > v_ga) then
    raise exception 'Résultat invalide';
  end if;
  return _career_apply(s.user_id, f.id,
    jsonb_build_object('win', (p ->> 'win')::boolean, 'gf', v_gf, 'ga', v_ga, 'goals', coalesce((p ->> 'goals')::int, 0), 'perfect', coalesce((p ->> 'perfect')::int, 0)),
    _career_rating(p || jsonb_build_object('conceded', v_ga, 'keeper', s.position = 'GB')), false);
end $$;

-- Simuler un match (moitié moins d'XP) : tirage côté serveur
create or replace function public.career_simulate(p_fixture bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s career_save; f career_fixtures; v_me int; v_opp int; v_p numeric; v_win boolean; v_goals int := 0; v_gf int; v_ga int; v_rating numeric; v_g numeric;
begin
  select * into s from career_save where user_id = auth.uid() for update;
  if s.user_id is null then raise exception 'Aucune carrière'; end if;
  select * into f from career_fixtures where id = p_fixture and user_id = s.user_id and season = s.season for update;
  if f.id is null or f.result is not null then raise exception 'Match indisponible'; end if;
  if exists (select 1 from career_fixtures where user_id = s.user_id and season = s.season and round < f.round and result is null) then
    raise exception 'Joue d''abord les matchs précédents';
  end if;
  select coalesce((select strength from career_clubs where club_key = s.club_key), 70), coalesce((select strength from career_clubs where club_key = f.opp_key), 70) into v_me, v_opp;
  v_p := least(0.85, greatest(0.15, 0.5 + (v_me - v_opp) / 40.0 + (_career_level(s.xp) - 10) / 200.0 + case when f.is_home then 0.05 else 0 end));
  v_win := random() < v_p;
  v_g := case s.position when 'ATT' then 0.75 when 'MIL' then 0.35 when 'DEF' then 0.12 else 0 end;
  for i in 1..3 loop if random() < v_g / 3 then v_goals := v_goals + 1; end if; end loop;
  v_gf := greatest(v_goals, case when v_win then 1 + floor(random() * 3)::int else floor(random() * 2)::int end);
  v_ga := case when v_win then floor(random() * v_gf)::int else v_gf + 1 + floor(random() * 2)::int end;
  v_rating := round(least(9.5, greatest(4, 6.1 + case when v_win then 0.4 else -0.4 end + v_goals * 0.9 + (random() - 0.5) * 1.2))::numeric, 1);
  return _career_apply(s.user_id, f.id, jsonb_build_object('win', v_win, 'gf', v_gf, 'ga', v_ga, 'goals', v_goals, 'perfect', 0), v_rating, true);
end $$;

-- Dépenser des points de compétence (ligne verrouillée : pas de double dépense)
create or replace function public.career_unlock_skill(p_node text)
returns int language plpgsql security definer set search_path = public as $$
declare n career_skill_nodes; s career_save; v_rank int; v_points int;
begin
  select * into s from career_save where user_id = auth.uid() for update;
  if s.user_id is null then raise exception 'Aucune carrière'; end if;
  select * into n from career_skill_nodes where id = p_node;
  if n.id is null then raise exception 'Compétence introuvable'; end if;
  select coalesce((select rank from career_skills where user_id = s.user_id and node_id = n.id), 0) into v_rank;
  if v_rank >= n.max_rank then raise exception 'Déjà au maximum' using hint = 'maxed'; end if;
  if _career_level(s.xp) < n.level_req then raise exception 'Niveau % requis', n.level_req using hint = 'level'; end if;
  if exists (select 1 from unnest(n.requires) r where not exists (select 1 from career_skills k where k.user_id = s.user_id and k.node_id = r)) then
    raise exception 'Débloque d''abord la compétence précédente' using hint = 'requires';
  end if;
  v_points := _career_points(s.user_id);
  if v_points < n.cost then raise exception 'Points insuffisants (% / %)', v_points, n.cost using hint = 'points'; end if;
  insert into career_skills(user_id, node_id, rank) values (s.user_id, n.id, 1)
    on conflict (user_id, node_id) do update set rank = career_skills.rank + 1, unlocked_at = now();
  update career_save set updated_at = now() where user_id = s.user_id;
  return v_points - n.cost;
end $$;

-- Fin de saison : bilan + offres (prolongation + 1 à 3 clubs selon la cote du joueur)
--   cote = note moyenne × 10 + buts × 3 + victoires × 2 + niveau
--   palier atteignable : ≥125 Élite, ≥105 Grand club, ≥85 Ambitieux, sinon Formateur ; offres : ≥100 → 3, ≥80 → 2, sinon 1
create or replace function public.career_close_season()
returns int language plpgsql security definer set search_path = public as $$
declare s career_save; st career_stats; v_avg numeric; v_score int; v_reach int; v_n int; v_mytier int; c record; v_count int := 0;
begin
  select * into s from career_save where user_id = auth.uid() for update;
  if s.user_id is null or s.phase <> 'season' then raise exception 'Pas de saison à clôturer'; end if;
  if exists (select 1 from career_fixtures where user_id = s.user_id and season = s.season and result is null) then raise exception 'La saison n''est pas terminée'; end if;
  select * into st from career_stats where user_id = s.user_id and season = s.season;
  v_avg := case when st.played > 0 then st.rating_sum / st.played else 0 end;
  v_score := round(v_avg * 10 + st.goals * 3 + st.wins * 2 + _career_level(s.xp));
  v_reach := case when v_score >= 125 then 1 when v_score >= 105 then 2 when v_score >= 85 then 3 else 4 end;
  v_n := case when v_score >= 100 then 3 when v_score >= 80 then 2 else 1 end;
  v_mytier := coalesce((select tier from career_clubs where club_key = s.club_key), 4);
  update career_stats set market_score = v_score, closed_at = now() where user_id = s.user_id and season = s.season;
  -- prolongation
  insert into career_offers(user_id, season, kind, club_key, club_name, tier, wage, years, role)
  values (s.user_id, s.season, 'renewal', s.club_key, s.club_name, v_mytier,
          round((array[90000, 45000, 18000, 7000])[v_mytier] * (0.8 + v_score / 250.0) * 0.9 / 500) * 500, 2, 'Prolongation de contrat');
  -- clubs intéressés
  for c in select * from career_clubs where club_key <> s.club_key and tier between v_reach and v_reach + 1
             order by tier + (random() - 0.5) * 1.2 limit v_n loop
    insert into career_offers(user_id, season, kind, club_key, club_name, tier, wage, years, role, bonus)
    values (s.user_id, s.season, 'transfer', c.club_key, c.name, c.tier,
            round((array[90000, 45000, 18000, 7000])[c.tier] * (0.8 + v_score / 250.0) / 500) * 500,
            case when c.tier <= 2 then 3 + floor(random() * 3) else 2 + floor(random() * 3) end,
            (array['Joueur important de l''effectif', 'Titulaire indiscutable', 'Leader du vestiaire', 'Star du club'])[least(4, greatest(1, 1 + c.tier - v_reach + case when c.tier >= 3 then 1 else 0 end))],
            round((array[90000, 45000, 18000, 7000])[c.tier] * (0.8 + v_score / 250.0) * (4 + random() * 8) / 1000) * 1000);
    v_count := v_count + 1;
  end loop;
  update career_save set phase = 'mercato', updated_at = now() where user_id = s.user_id;
  return v_count;
end $$;

create or replace function public.career_read_offer(p_offer bigint) returns void
language sql security definer set search_path = public as $$
  update career_offers set status = 'read' where id = p_offer and user_id = auth.uid() and status = 'new'
$$;

-- Accepter / refuser : signer une offre fait expirer les autres de la même saison
create or replace function public.career_answer_offer(p_offer bigint, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare s career_save; o career_offers;
begin
  select * into s from career_save where user_id = auth.uid() for update;
  if s.user_id is null then raise exception 'Aucune carrière'; end if;
  select * into o from career_offers where id = p_offer and user_id = s.user_id for update;
  if o.id is null or o.status not in ('new','read') or o.season <> s.season then raise exception 'Cette offre n''est plus valable'; end if;
  if o.kind = 'debut' then
    update career_offers set status = 'accepted', answered_at = now() where id = o.id;
    return 'accepted';
  end if;
  if s.phase <> 'mercato' then raise exception 'Le mercato est fermé'; end if;
  if not p_accept then
    update career_offers set status = 'declined', answered_at = now() where id = o.id;
    return 'declined';
  end if;
  update career_offers set status = 'accepted', answered_at = now() where id = o.id;
  update career_offers set status = 'expired', answered_at = now()
   where user_id = s.user_id and season = s.season and id <> o.id and kind in ('renewal','transfer') and status in ('new','read');
  update career_save set club_key = o.club_key, club_name = o.club_name, contract_until = s.season + o.years, wage = o.wage, role = o.role, updated_at = now()
   where user_id = s.user_id;
  return 'accepted';
end $$;

-- Saison suivante (dans le club signé, ou on reste si toutes les offres ont été refusées)
create or replace function public.career_new_season() returns int
language plpgsql security definer set search_path = public as $$
declare s career_save;
begin
  select * into s from career_save where user_id = auth.uid() for update;
  if s.user_id is null or s.phase <> 'mercato' then raise exception 'Le mercato n''est pas ouvert'; end if;
  update career_offers set status = 'expired', answered_at = now() where user_id = s.user_id and season = s.season and kind <> 'debut' and status in ('new','read');
  update career_save set season = season + 1, phase = 'season', updated_at = now() where user_id = s.user_id;
  perform _career_make_fixtures(s.user_id, s.season + 1);
  return s.season + 1;
end $$;

-- Lecture pour l'interface : sauvegarde + niveau + points restants + arbre
create or replace function public.career_get() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(s) - 'seed' || jsonb_build_object('level', _career_level(s.xp), 'points', _career_points(s.user_id),
         'skills', coalesce((select jsonb_object_agg(k.node_id, k.rank) from career_skills k where k.user_id = s.user_id), '{}'::jsonb))
    from career_save s where s.user_id = auth.uid()
$$;

-- -----------------------------------------------------------------------------
-- 7. DROITS
-- -----------------------------------------------------------------------------
revoke execute on function public._career_points(uuid), public._career_make_fixtures(uuid, int), public._career_apply(uuid, bigint, jsonb, numeric, boolean) from public, anon, authenticated;
revoke execute on function public.career_start(text, int, text, text, jsonb, text, text), public.career_reset(), public.career_kickoff(bigint),
  public.career_report_match(bigint, jsonb), public.career_simulate(bigint), public.career_unlock_skill(text), public.career_close_season(),
  public.career_read_offer(bigint), public.career_answer_offer(bigint, boolean), public.career_new_season(), public.career_get() from public, anon;
grant execute on function public.career_start(text, int, text, text, jsonb, text, text), public.career_reset(), public.career_kickoff(bigint),
  public.career_report_match(bigint, jsonb), public.career_simulate(bigint), public.career_unlock_skill(text), public.career_close_season(),
  public.career_read_offer(bigint), public.career_answer_offer(bigint, boolean), public.career_new_season(), public.career_get() to authenticated;
