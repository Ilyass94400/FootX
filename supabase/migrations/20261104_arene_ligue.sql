-- =============================================================================
-- FootX TCG — schéma Arène (PvP temps réel) + Ligue (fantasy asynchrone)
-- À exécuter dans Supabase > SQL Editor (ou `supabase db push`).
-- ⚠ Suppose que public.cards.id est un BIGINT. Si c'est un UUID, remplace
--   "card_id bigint" par "card_id uuid" (2 occurrences).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. SOCLE COMMUN : joueurs, cartes possédées, compo
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null,
  avatar_url  text,
  elo         int  not null default 1000,           -- matchmaking de l'Arène
  win_streak  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- Chaque exemplaire possédé est une ligne (permet doublons, échanges, numéros de série).
create table if not exists public.user_cards (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  card_id     bigint not null references public.cards(id),
  source      text not null default 'pack' check (source in ('pack','reward','trade','event')),
  obtained_at timestamptz not null default now()
);
create index if not exists user_cards_owner_idx on public.user_cards(owner_id);

-- Lien carte FootX → joueur réel chez le fournisseur de stats (pour la Ligue).
alter table public.cards add column if not exists real_player_ref text;

-- Compo de l'Arène (5 titulaires). Une seule active par joueur.
create table if not exists public.squads (
  owner_id   uuid primary key references public.profiles(id) on delete cascade,
  gk  uuid references public.user_cards(id),
  d1  uuid references public.user_cards(id),
  d2  uuid references public.user_cards(id),
  a1  uuid references public.user_cards(id),
  a2  uuid references public.user_cards(id),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 1. ARÈNE — temps réel. Supabase Realtime (Broadcast) transporte les événements
--    pendant le match ; ces tables sont la VÉRITÉ (anti-triche + historique).
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.match_status as enum ('waiting','live','finished','abandoned');
exception when duplicate_object then null; end $$;

create table if not exists public.arena_queue (
  user_id   uuid primary key references public.profiles(id) on delete cascade,
  elo       int not null,
  joined_at timestamptz not null default now()
);

create table if not exists public.arena_matches (
  id            uuid primary key default gen_random_uuid(),
  home_id       uuid not null references public.profiles(id),
  away_id       uuid references public.profiles(id),          -- null = contre l'IA
  seed          bigint not null,                              -- graine du moteur (rejouable)
  engine_version text not null default '1',
  home_squad    jsonb not null,                               -- snapshot des 5 cartes au coup d'envoi
  away_squad    jsonb not null,
  status        public.match_status not null default 'waiting',
  action_idx    int not null default 0,
  home_score    int not null default 0,
  away_score    int not null default 0,
  winner_id     uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists arena_matches_players_idx on public.arena_matches(home_id, away_id);

-- Choix simultanés en "commit-reveal" : chacun envoie d'abord un hash
-- sha256(choix || sel), puis révèle choix + sel quand les deux ont committé.
-- Impossible de voir le choix adverse avant de jouer le sien.
create table if not exists public.arena_moves (
  match_id    uuid not null references public.arena_matches(id) on delete cascade,
  action_idx  int  not null,
  player_id   uuid not null references public.profiles(id),
  commit_hash text not null,
  choice      text check (choice in ('force','feinte','lob','plonger','sortir','rester')),
  salt        text,
  qte_ms      int,                 -- écart au centre de la zone QTE (validé côté serveur)
  committed_at timestamptz not null default now(),
  revealed_at  timestamptz,
  primary key (match_id, action_idx, player_id)
);

-- -----------------------------------------------------------------------------
-- 2. LIGUE — asynchrone, rythmée par les journées du championnat réel.
-- -----------------------------------------------------------------------------
create table if not exists public.leagues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 32),
  owner_id    uuid not null references public.profiles(id),
  invite_code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  season      int  not null default 1,
  created_at  timestamptz not null default now()
);

create table if not exists public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table if not exists public.gameweeks (
  id         serial primary key,
  season     int not null,
  number     int not null,
  deadline   timestamptz not null,       -- verrouillage (vendredi 19:00 Europe/Paris)
  ends_at    timestamptz not null,       -- fin des matchs du week-end
  status     text not null default 'open' check (status in ('open','locked','scoring','done')),
  unique (season, number)
);

-- Stats IRL par joueur réel et par journée (remplies par une Edge Function planifiée).
create table if not exists public.player_gameweek_stats (
  gameweek_id     int  not null references public.gameweeks(id) on delete cascade,
  real_player_ref text not null,
  played int default 0, sub int default 0, goals int default 0, assists int default 0,
  shots int default 0, clean int default 0, saves int default 0, conceded int default 0,
  yellow int default 0, red int default 0, own_goal int default 0,
  updated_at timestamptz not null default now(),
  primary key (gameweek_id, real_player_ref)
);

-- Une compo par joueur et par journée : elle compte dans TOUTES ses ligues.
create table if not exists public.lineups (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  gameweek_id  int  not null references public.gameweeks(id),
  captain_slot text not null check (captain_slot in ('GK','D1','D2','A1','A2')),
  locked_at    timestamptz not null default now(),
  total_points numeric(6,1),                 -- rempli au calcul du lundi
  primary key (user_id, gameweek_id)
);

create table if not exists public.lineup_cards (
  user_id      uuid not null,
  gameweek_id  int  not null,
  slot         text not null check (slot in ('GK','D1','D2','A1','A2')),
  user_card_id uuid not null references public.user_cards(id),
  rarity       text not null,                -- snapshot : le multiplicateur ne change plus après le verrou
  points       numeric(6,1),
  breakdown    jsonb,                        -- détail des lignes du barème (affiché dans l'UI)
  primary key (user_id, gameweek_id, slot),
  unique (gameweek_id, user_card_id),        -- une carte ne joue qu'une fois par journée
  foreign key (user_id, gameweek_id) references public.lineups(user_id, gameweek_id) on delete cascade
);

-- Classement d'une ligue = somme des points de ses membres sur la saison.
create or replace view public.league_standings with (security_invoker = true) as
select m.league_id, m.user_id, p.username, p.avatar_url,
       coalesce(sum(l.total_points), 0) as points,
       rank() over (partition by m.league_id order by coalesce(sum(l.total_points), 0) desc) as rank
from public.league_members m
join public.profiles p on p.id = m.user_id
join public.leagues lg on lg.id = m.league_id
left join public.gameweeks g on g.season = lg.season
left join public.lineups l on l.user_id = m.user_id and l.gameweek_id = g.id
group by m.league_id, m.user_id, p.username, p.avatar_url;

-- -----------------------------------------------------------------------------
-- 3. SÉCURITÉ (RLS) — le client lit ce qui le concerne, n'écrit que ses coups.
--    Les scores, résultats et points sont écrits UNIQUEMENT par les Edge
--    Functions (clé service_role, qui contourne la RLS).
-- -----------------------------------------------------------------------------
alter table public.profiles              enable row level security;
alter table public.user_cards            enable row level security;
alter table public.squads                enable row level security;
alter table public.arena_queue           enable row level security;
alter table public.arena_matches         enable row level security;
alter table public.arena_moves           enable row level security;
alter table public.leagues               enable row level security;
alter table public.league_members        enable row level security;
alter table public.gameweeks             enable row level security;
alter table public.player_gameweek_stats enable row level security;
alter table public.lineups               enable row level security;
alter table public.lineup_cards          enable row level security;

create policy "profils lisibles"        on public.profiles   for select using (true);
create policy "mon profil"              on public.profiles   for update using (auth.uid() = id);
create policy "mes cartes"              on public.user_cards for select using (auth.uid() = owner_id);
create policy "ma compo"                on public.squads     for all    using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "file d'attente"          on public.arena_queue for all   using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "mes matchs"              on public.arena_matches for select using (auth.uid() in (home_id, away_id));

-- coups : on ne voit le choix adverse qu'une fois révélé
create policy "coups visibles"          on public.arena_moves for select using (
  player_id = auth.uid()
  or (revealed_at is not null and exists (select 1 from public.arena_matches m where m.id = match_id and auth.uid() in (m.home_id, m.away_id))));
create policy "je committe mon coup"    on public.arena_moves for insert with check (
  player_id = auth.uid()
  and exists (select 1 from public.arena_matches m where m.id = match_id and m.status = 'live' and auth.uid() in (m.home_id, m.away_id)));
-- la révélation (choice/salt) passe par l'Edge Function arena-reveal qui vérifie le hash

-- helper "security definer" : évite la récursion infinie d'une policy qui relirait league_members
create or replace function public.is_league_member(lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.league_members where league_id = lid and user_id = auth.uid())
$$;

create policy "ligues de mes membres"   on public.leagues for select using (public.is_league_member(id) or owner_id = auth.uid());
create policy "créer une ligue"         on public.leagues for insert with check (owner_id = auth.uid());
create policy "membres visibles"        on public.league_members for select using (public.is_league_member(league_id));
-- rejoindre par code : via la fonction join_league() ci-dessous (security definer)

create policy "journées publiques"      on public.gameweeks for select using (true);
create policy "stats publiques"         on public.player_gameweek_stats for select using (true);
create policy "compos lisibles"         on public.lineups for select using (true);
create policy "cartes de compo"         on public.lineup_cards for select using (true);

-- Verrouiller sa compo : seulement avant la deadline, et avec SES cartes.
create policy "je verrouille avant la deadline" on public.lineups for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.gameweeks g where g.id = gameweek_id and now() < g.deadline));
create policy "je déverrouille avant la deadline" on public.lineups for delete using (
  user_id = auth.uid()
  and exists (select 1 from public.gameweeks g where g.id = gameweek_id and now() < g.deadline));
create policy "mes cartes en compo" on public.lineup_cards for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.user_cards uc where uc.id = user_card_id and uc.owner_id = auth.uid())
  and exists (select 1 from public.gameweeks g where g.id = gameweek_id and now() < g.deadline));

-- -----------------------------------------------------------------------------
-- 4. FONCTIONS
-- -----------------------------------------------------------------------------
create or replace function public.join_league(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  select id into lid from public.leagues where invite_code = upper(code);
  if lid is null then raise exception 'Code inconnu'; end if;
  if (select count(*) from public.league_members where league_id = lid) >= 20 then raise exception 'Ligue complète'; end if;
  insert into public.league_members(league_id, user_id) values (lid, auth.uid()) on conflict do nothing;
  return lid;
end $$;

-- Le créateur devient membre automatiquement.
create or replace function public.leagues_add_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.league_members(league_id, user_id) values (new.id, new.owner_id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists leagues_add_owner on public.leagues;
create trigger leagues_add_owner after insert on public.leagues for each row execute function public.leagues_add_owner();

-- Realtime : les joueurs d'un match reçoivent les changements de score/état.
alter publication supabase_realtime add table public.arena_matches;
