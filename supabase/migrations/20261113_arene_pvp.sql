-- =============================================================================
-- FootX TCG — ARÈNE EN JOUEUR CONTRE JOUEUR (temps réel)
-- Dépend de 20261110 → 20261112. Peut être relancée sans risque.
--
-- Principe :
--   • File d'attente : le joueur entre avec ses 5 cartes (vérifiées : il doit les posséder).
--     Deux joueurs sont appariés (niveau elo proche, la fourchette s'élargit avec l'attente).
--   • Le match tourne dans les DEUX navigateurs avec la même graine (moteur déterministe).
--     Le serveur est l'ARBITRE : chacun envoie son choix, mais ne reçoit celui de l'autre
--     qu'une fois les deux choix enregistrés (impossible de tricher en lisant le choix adverse).
--   • Joueur absent : après 12 s sans réponse, le serveur joue un choix au hasard pour lui
--     (avec pénalité d'hésitation). Deux actions de suite sans lui → il a abandonné.
--   • Fin : les deux navigateurs annoncent le score ; s'ils concordent, le match est validé
--     (elo, X-Coins, booster de victoire, série, défis).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABLES
-- -----------------------------------------------------------------------------
alter table public.arena_queue add column if not exists squad   jsonb;
alter table public.arena_queue add column if not exists name    text;
alter table public.arena_queue add column if not exists avatar  text;
alter table public.arena_queue add column if not exists seen_at timestamptz not null default now();
revoke insert, update, delete on public.arena_queue from anon, authenticated;      -- tout passe par les fonctions

alter table public.arena_matches add column if not exists mode       text not null default 'ai';   -- 'ai' | 'pvp'
alter table public.arena_matches add column if not exists reports    jsonb not null default '{}'::jsonb;
alter table public.arena_matches add column if not exists forfeit_id uuid references public.profiles(id);
create index if not exists arena_matches_pvp_live_idx on public.arena_matches(created_at) where mode = 'pvp' and status = 'live';

-- Coups d'un match PvP. Aucune lecture directe possible (RLS sans règle de lecture) :
-- le choix adverse n'est révélé que par arena_pvp_wait(), quand les deux ont joué.
create table if not exists public.arena_pvp_moves (
  match_id    uuid not null references public.arena_matches(id) on delete cascade,
  idx         int  not null check (idx between 0 and 80),
  player_id   uuid not null references public.profiles(id) on delete cascade,
  choice      text check (choice in ('force', 'feinte', 'lob', 'plonger', 'sortir', 'rester')),
  hesitated   boolean not null default false,
  auto_choice boolean not null default false,          -- joué par le serveur (joueur absent)
  choice_at   timestamptz,
  qte         text check (qte in ('perfect', 'good', 'miss')),
  auto_qte    boolean not null default false,
  qte_at      timestamptz,
  primary key (match_id, idx, player_id)
);
alter table public.arena_pvp_moves enable row level security;
revoke all on public.arena_pvp_moves from anon, authenticated;

alter table public.economy_settings add column if not exists pvp_grace_sec int not null default 12;

-- -----------------------------------------------------------------------------
-- 2. OUTILS
-- -----------------------------------------------------------------------------
-- Les 5 cartes envoyées : toutes possédées, toutes différentes → photo figée des cartes
create or replace function public._pvp_squad(p_uid uuid, p_team jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text; v text; v_out jsonb := '{}'::jsonb; v_seen bigint[] := '{}'; c cards;
begin
  if p_team is null or jsonb_typeof(p_team) <> 'object' then raise exception 'Équipe invalide' using hint = 'invalid'; end if;
  foreach k in array array['GK','D1','D2','A1','A2'] loop
    v := p_team ->> k;
    if v is null or v !~ '^[0-9]{1,18}$' then raise exception 'Il manque un titulaire' using hint = 'invalid'; end if;
    if v::bigint = any(v_seen) then raise exception 'Une carte ne peut jouer qu''à un seul poste' using hint = 'invalid'; end if;
    if not exists (select 1 from user_cards where owner_id = p_uid and card_id = v::bigint) then
      raise exception 'Tu ne possèdes pas cette carte' using hint = 'not_owner';
    end if;
    select * into c from cards where id = v::bigint;
    v_seen := v_seen || v::bigint;
    v_out := v_out || jsonb_build_object(k, to_jsonb(c));
  end loop;
  return v_out;
end $$;

-- Ce que le navigateur reçoit pour lancer le match
create or replace function public._pvp_json(m public.arena_matches, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'seed', m.seed, 'role', case when m.home_id = p_uid then 'home' else 'away' end, 'status', m.status,
    'me',  jsonb_build_object('name', me.username, 'avatar', me.avatar_url, 'elo', me.elo,
                              'squad', case when m.home_id = p_uid then m.home_squad else m.away_squad end),
    'opp', jsonb_build_object('name', op.username, 'avatar', op.avatar_url, 'elo', op.elo,
                              'squad', case when m.home_id = p_uid then m.away_squad else m.home_squad end))
  from profiles me, profiles op
  where me.id = p_uid and op.id = case when m.home_id = p_uid then m.away_id else m.home_id end
$$;

-- Mon match PvP en cours (récent, pas encore terminé)
create or replace function public._pvp_current(p_uid uuid) returns public.arena_matches
language sql stable security definer set search_path = public as $$
  select * from arena_matches
  where mode = 'pvp' and status = 'live' and p_uid in (home_id, away_id) and created_at > now() - interval '20 minutes'
  order by created_at desc limit 1
$$;

-- Récompenses d'un joueur (mêmes règles que contre l'IA) : X-Coins plafonnés, booster de victoire, série
create or replace function public._arena_reward(p_uid uuid, p_match uuid, p_win boolean, p_coins boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s economy_settings; b user_boosters; v_today date := (now() at time zone 'Europe/Paris')::date;
  v_n int; v_coins bigint := 0; v_capped boolean := false; v_booster boolean := false; v_full boolean := false;
  v_left int; v_wins int; v_streak int;
begin
  select * into s from economy_settings;
  update profiles set win_streak = case when p_win then win_streak + 1 else 0 end where id = p_uid returning win_streak into v_streak;
  if p_coins then
    select count(*) into v_n from transactions_history
      where user_id = p_uid and kind = 'match_reward' and created_at >= (v_today::timestamp at time zone 'Europe/Paris');
    if v_n < s.match_daily_cap then
      v_coins := case when p_win then s.match_win else s.match_loss end;
      perform _move_coins(p_uid, v_coins, 'match_reward', p_match::text, 'match:' || p_match || ':' || p_uid);
    else
      v_capped := true;
    end if;
  end if;
  if p_win then
    b := _booster_row(p_uid);
    v_wins := case when b.win_day = v_today then b.win_boosters else 0 end;
    if v_wins >= s.win_boosters_day then v_left := 0;
    elsif b.stock >= s.booster_max then v_full := true; v_left := s.win_boosters_day - v_wins;
    else
      perform _set_stock(p_uid, b, b.stock + 1);
      update user_boosters set win_day = v_today, win_boosters = v_wins + 1 where user_id = p_uid;
      v_booster := true; v_left := s.win_boosters_day - v_wins - 1;
    end if;
  end if;
  return jsonb_build_object('coins', v_coins, 'capped', v_capped, 'booster', v_booster, 'full', v_full,
    'left', v_left, 'streak', v_streak, 'state', _booster_json(p_uid));
end $$;

-- Clôture d'un match PvP : score, elo, récompenses des deux joueurs, défis (trigger)
create or replace function public._pvp_close(p_match uuid, p_winner uuid, p_forfeit uuid, p_home int, p_away int,
  p_perfect jsonb, p_goals jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare m arena_matches; ra int; rb int; ea numeric; sa numeric; dh int := 0; v_home jsonb; v_away jsonb;
begin
  select * into m from arena_matches where id = p_match for update;
  if m.status <> 'live' then return; end if;
  select elo into ra from profiles where id = m.home_id;
  select elo into rb from profiles where id = m.away_id;
  if p_winner is not null then
    ea := 1 / (1 + power(10, (rb - ra) / 400.0));
    sa := case when p_winner = m.home_id then 1 else 0 end;
    dh := round(32 * (sa - ea));
    update profiles set elo = greatest(100, elo + dh) where id = m.home_id;
    update profiles set elo = greatest(100, elo - dh) where id = m.away_id;
  end if;
  update arena_matches set status = 'finished', finished_at = now(), winner_id = p_winner, forfeit_id = p_forfeit,
    home_score = least(greatest(coalesce(p_home, 0), 0), 30), away_score = least(greatest(coalesce(p_away, 0), 0), 30),
    perfect_qte = coalesce(p_perfect, '{}'::jsonb), goal_log = coalesce(p_goals, '[]'::jsonb)
    where id = p_match;                                                        -- → défis des deux joueurs
  -- celui qui a abandonné n'est pas payé
  v_home := _arena_reward(m.home_id, p_match, p_winner = m.home_id, p_forfeit is distinct from m.home_id) || jsonb_build_object('elo_delta', dh);
  v_away := _arena_reward(m.away_id, p_match, p_winner = m.away_id, p_forfeit is distinct from m.away_id) || jsonb_build_object('elo_delta', -dh);
  update arena_matches set reward = jsonb_build_object('home', v_home, 'away', v_away) where id = p_match;
end $$;

-- Je quitte la file pour un nouveau match alors qu'un ancien était en cours : je l'abandonne
create or replace function public._pvp_forfeit_mine(p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m arena_matches;
begin
  for m in select * from arena_matches where mode = 'pvp' and status = 'live' and p_uid in (home_id, away_id) loop
    perform _pvp_close(m.id, case when m.home_id = p_uid then m.away_id else m.home_id end, p_uid,
      m.home_score, m.away_score, '{}'::jsonb, '[]'::jsonb);
  end loop;
end $$;

-- Tente d'apparier ce joueur avec quelqu'un de la file (verrous dans un ordre fixe : pas d'interblocage)
create or replace function public._pvp_pair(p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me arena_queue; cand arena_queue; m arena_matches; v_wait int;
begin
  select * into me from arena_queue where user_id = p_uid;
  if me.user_id is null then return null; end if;
  v_wait := extract(epoch from now() - me.joined_at)::int;
  select q.* into cand from arena_queue q
    where q.user_id <> p_uid and q.seen_at > now() - interval '8 seconds' and q.squad is not null
    order by (abs(q.elo - me.elo) <= 150 + v_wait * 25) desc, abs(q.elo - me.elo), q.joined_at
    limit 1;
  if cand.user_id is null then return null; end if;
  perform 1 from arena_queue where user_id in (p_uid, cand.user_id) order by user_id for update;
  if (select count(*) from arena_queue where user_id in (p_uid, cand.user_id)) < 2 then return null; end if;
  insert into arena_matches(home_id, away_id, seed, home_squad, away_squad, status, mode)
    values (cand.user_id, p_uid, floor(random() * 2147483647)::bigint, cand.squad, me.squad, 'live', 'pvp')
    returning * into m;
  delete from arena_queue where user_id in (p_uid, cand.user_id);
  return _pvp_json(m, p_uid);
end $$;

-- -----------------------------------------------------------------------------
-- 3. FILE D'ATTENTE
-- -----------------------------------------------------------------------------
create or replace function public.arena_queue_join(p_team jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_squad jsonb; v jsonb;
begin
  perform _ensure_profile(v_uid);
  perform _pvp_forfeit_mine(v_uid);
  v_squad := _pvp_squad(v_uid, p_team);
  insert into arena_queue(user_id, elo, joined_at, seen_at, squad, name, avatar)
    select v_uid, p.elo, now(), now(), v_squad, p.username, p.avatar_url from profiles p where p.id = v_uid
    on conflict (user_id) do update set squad = excluded.squad, seen_at = now(), elo = excluded.elo, joined_at = now();
  v := _pvp_pair(v_uid);
  return coalesce(v, jsonb_build_object('waiting', true,
    'players', (select count(*) from arena_queue where seen_at > now() - interval '8 seconds')));
end $$;

-- Appelé toutes les ~1,5 s pendant la recherche : "je suis toujours là", et apparie si possible
create or replace function public.arena_queue_poll()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); m arena_matches; v jsonb;
begin
  perform _ensure_profile(v_uid);
  m := _pvp_current(v_uid);
  if m.id is not null then return _pvp_json(m, v_uid); end if;            -- quelqu'un m'a apparié
  update arena_queue set seen_at = now() where user_id = v_uid;
  if not found then return jsonb_build_object('idle', true); end if;
  v := _pvp_pair(v_uid);
  return coalesce(v, jsonb_build_object('waiting', true,
    'players', (select count(*) from arena_queue where seen_at > now() - interval '8 seconds')));
end $$;

-- Je quitte la recherche (annulation, ou passage contre l'IA). Si j'ai été apparié entre-temps, on joue.
create or replace function public.arena_queue_leave()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); m arena_matches;
begin
  perform _ensure_profile(v_uid);
  delete from arena_queue where user_id = v_uid;
  m := _pvp_current(v_uid);
  if m.id is not null then return _pvp_json(m, v_uid); end if;
  return jsonb_build_object('left', true);
end $$;

-- -----------------------------------------------------------------------------
-- 4. PENDANT LE MATCH : coups, arbitre, joueur absent
-- -----------------------------------------------------------------------------
-- p_step : 'choice' | 'qte'. Renvoie les deux coups quand ils sont là, sinon { waiting }.
create or replace function public.arena_pvp_wait(p_match uuid, p_idx int, p_step text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); m arena_matches; s economy_settings; v_opp uuid;
  mine arena_pvp_moves; theirs arena_pvp_moves; v_auto text;
begin
  select * into m from arena_matches where id = p_match;
  if m.id is null or m.mode <> 'pvp' or v_uid not in (m.home_id, m.away_id) then raise exception 'Match introuvable' using hint = 'not_found'; end if;
  if m.status <> 'live' then
    return jsonb_build_object('finished', true, 'win', coalesce(m.winner_id = v_uid, false), 'forfeit', m.forfeit_id is not null and m.forfeit_id <> v_uid, 'abandoned', m.forfeit_id = v_uid);
  end if;
  select * into s from economy_settings;
  v_opp := case when m.home_id = v_uid then m.away_id else m.home_id end;
  perform 1 from arena_pvp_moves where match_id = p_match and idx = p_idx for update;
  select * into mine   from arena_pvp_moves where match_id = p_match and idx = p_idx and player_id = v_uid;
  select * into theirs from arena_pvp_moves where match_id = p_match and idx = p_idx and player_id = v_opp;

  if p_step = 'choice' then
    if mine.choice is null then return jsonb_build_object('waiting', 'me'); end if;
    if theirs.choice is null then
      if now() - mine.choice_at < make_interval(secs => s.pvp_grace_sec) then return jsonb_build_object('waiting', 'opp'); end if;
      -- l'adversaire ne répond plus : choix au hasard pour lui (rôle inverse du mien), avec hésitation
      v_auto := case when mine.choice in ('force', 'feinte', 'lob')
                     then (array['plonger', 'sortir', 'rester'])[1 + floor(random() * 3)::int]
                     else (array['force', 'feinte', 'lob'])[1 + floor(random() * 3)::int] end;
      insert into arena_pvp_moves(match_id, idx, player_id, choice, hesitated, auto_choice, choice_at)
        values (p_match, p_idx, v_opp, v_auto, true, true, now())
        on conflict (match_id, idx, player_id) do update
          set choice = coalesce(arena_pvp_moves.choice, excluded.choice),
              hesitated = case when arena_pvp_moves.choice is null then true else arena_pvp_moves.hesitated end,
              auto_choice = arena_pvp_moves.choice is null, choice_at = coalesce(arena_pvp_moves.choice_at, now());
      -- deux actions de suite sans lui : il a abandonné, victoire pour moi
      if exists (select 1 from arena_pvp_moves where match_id = p_match and player_id = v_opp and idx = p_idx - 1 and auto_choice) then
        perform _pvp_close(p_match, v_uid, v_opp, m.home_score, m.away_score, '{}'::jsonb, '[]'::jsonb);
        return jsonb_build_object('finished', true, 'win', true, 'forfeit', true);
      end if;
      select * into theirs from arena_pvp_moves where match_id = p_match and idx = p_idx and player_id = v_opp;
    end if;
    return jsonb_build_object('me',  jsonb_build_object('choice', mine.choice,   'hesitated', mine.hesitated),
                              'opp', jsonb_build_object('choice', theirs.choice, 'hesitated', theirs.hesitated));
  elsif p_step = 'qte' then
    if mine.qte is null then return jsonb_build_object('waiting', 'me'); end if;
    if theirs.qte is null then
      if now() - mine.qte_at < make_interval(secs => s.pvp_grace_sec) then return jsonb_build_object('waiting', 'opp'); end if;
      insert into arena_pvp_moves(match_id, idx, player_id, qte, auto_qte, qte_at) values (p_match, p_idx, v_opp, 'miss', true, now())
        on conflict (match_id, idx, player_id) do update
          set qte = coalesce(arena_pvp_moves.qte, 'miss'), auto_qte = arena_pvp_moves.qte is null, qte_at = coalesce(arena_pvp_moves.qte_at, now());
      select * into theirs from arena_pvp_moves where match_id = p_match and idx = p_idx and player_id = v_opp;
    end if;
    return jsonb_build_object('me', jsonb_build_object('qte', mine.qte), 'opp', jsonb_build_object('qte', theirs.qte));
  end if;
  raise exception 'Étape inconnue' using hint = 'invalid';
end $$;

create or replace function public.arena_pvp_move(p_match uuid, p_idx int, p_choice text, p_hesitated boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); m arena_matches;
begin
  select * into m from arena_matches where id = p_match;
  if m.id is null or m.mode <> 'pvp' or v_uid not in (m.home_id, m.away_id) then raise exception 'Match introuvable' using hint = 'not_found'; end if;
  if m.status = 'live' then
    if p_choice not in ('force', 'feinte', 'lob', 'plonger', 'sortir', 'rester') then raise exception 'Choix invalide' using hint = 'invalid'; end if;
    insert into arena_pvp_moves(match_id, idx, player_id, choice, hesitated, choice_at)
      values (p_match, p_idx, v_uid, p_choice, coalesce(p_hesitated, false), now())
      on conflict (match_id, idx, player_id) do update                   -- un coup déjà joué (ou joué par le serveur) ne change plus
        set choice = coalesce(arena_pvp_moves.choice, excluded.choice),
            hesitated = case when arena_pvp_moves.choice is null then excluded.hesitated else arena_pvp_moves.hesitated end,
            choice_at = coalesce(arena_pvp_moves.choice_at, now());
  end if;
  return arena_pvp_wait(p_match, p_idx, 'choice');
end $$;

create or replace function public.arena_pvp_qte(p_match uuid, p_idx int, p_q text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); m arena_matches;
begin
  select * into m from arena_matches where id = p_match;
  if m.id is null or m.mode <> 'pvp' or v_uid not in (m.home_id, m.away_id) then raise exception 'Match introuvable' using hint = 'not_found'; end if;
  if m.status = 'live' then
    if p_q not in ('perfect', 'good', 'miss') then raise exception 'Réussite invalide' using hint = 'invalid'; end if;
    insert into arena_pvp_moves(match_id, idx, player_id, qte, qte_at) values (p_match, p_idx, v_uid, p_q, now())
      on conflict (match_id, idx, player_id) do update
        set qte = coalesce(arena_pvp_moves.qte, excluded.qte), qte_at = coalesce(arena_pvp_moves.qte_at, now());
  end if;
  return arena_pvp_wait(p_match, p_idx, 'qte');
end $$;

-- -----------------------------------------------------------------------------
-- 5. FIN DE MATCH
-- -----------------------------------------------------------------------------
-- Chaque navigateur annonce SON score (point de vue du joueur). Les deux concordent → validé.
-- Si l'adversaire ne répond pas dans les 15 s, l'annonce seule fait foi.
create or replace function public.arena_pvp_finish(p_match uuid, p_my int, p_opp int, p_win boolean,
  p_perfect int default 0, p_goals jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); m arena_matches; v_side text; v_other text; r jsonb; o jsonb; v_goals jsonb;
  v_winner uuid; v_home int; v_away int;
begin
  perform _ensure_profile(v_uid);
  select * into m from arena_matches where id = p_match for update;
  if m.id is null or m.mode <> 'pvp' or v_uid not in (m.home_id, m.away_id) then raise exception 'Match introuvable' using hint = 'not_found'; end if;
  v_side := case when m.home_id = v_uid then 'home' else 'away' end;
  v_other := case when v_side = 'home' then 'away' else 'home' end;
  if m.status = 'finished' then
    return coalesce(m.reward -> v_side, '{}'::jsonb) || jsonb_build_object('finished', true, 'win', coalesce(m.winner_id = v_uid, false),
      'forfeit', m.forfeit_id is not null and m.forfeit_id <> v_uid, 'abandoned', coalesce(m.forfeit_id = v_uid, false),
      'disputed', m.winner_id is null, 'home', m.home_score, 'away', m.away_score);
  end if;
  if m.status <> 'live' then raise exception 'Ce match a été annulé' using hint = 'closed'; end if;

  if not (m.reports ? v_side) then
    select coalesce(jsonb_agg(jsonb_build_object('side', v_side, 'country', left(g ->> 'country', 60), 'club', left(g ->> 'club', 80))), '[]'::jsonb)
      into v_goals
      from (select g from jsonb_array_elements(case when jsonb_typeof(p_goals) = 'array' then p_goals else '[]'::jsonb end) g limit 30) t;
    r := jsonb_build_object(
      'home', case when v_side = 'home' then p_my else p_opp end, 'away', case when v_side = 'home' then p_opp else p_my end,
      'home_win', case when v_side = 'home' then p_win else not p_win end,
      'perfect', least(greatest(coalesce(p_perfect, 0), 0), 20), 'goals', v_goals, 'at', now());
    update arena_matches set reports = reports || jsonb_build_object(v_side, r) where id = p_match returning * into m;
  end if;
  r := m.reports -> v_side;
  o := m.reports -> v_other;

  if o is null and now() - (r ->> 'at')::timestamptz < interval '15 seconds' then
    return jsonb_build_object('pending', true);
  end if;
  if o is not null and ((o ->> 'home')::int <> (r ->> 'home')::int or (o ->> 'away')::int <> (r ->> 'away')::int
                        or (o ->> 'home_win')::boolean <> (r ->> 'home_win')::boolean) then
    v_winner := null;                                                    -- désaccord : match nul, sans vainqueur
  else
    v_winner := case when (r ->> 'home_win')::boolean then m.home_id else m.away_id end;
  end if;
  v_home := (r ->> 'home')::int; v_away := (r ->> 'away')::int;
  perform _pvp_close(p_match, v_winner, null, v_home, v_away,
    jsonb_build_object('home', coalesce((m.reports -> 'home' ->> 'perfect')::int, 0), 'away', coalesce((m.reports -> 'away' ->> 'perfect')::int, 0)),
    coalesce(m.reports -> 'home' -> 'goals', '[]'::jsonb) || coalesce(m.reports -> 'away' -> 'goals', '[]'::jsonb));
  select * into m from arena_matches where id = p_match;
  return coalesce(m.reward -> v_side, '{}'::jsonb) || jsonb_build_object('finished', true, 'win', coalesce(m.winner_id = v_uid, false),
    'forfeit', false, 'abandoned', false, 'disputed', m.winner_id is null, 'home', m.home_score, 'away', m.away_score);
end $$;

-- -----------------------------------------------------------------------------
-- 6. MÉNAGE : matchs PvP laissés en plan, file d'attente fantôme
-- -----------------------------------------------------------------------------
create or replace function public.footx_cleanup() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_open int; v_events int; v_matches int; v_pvp int;
begin
  delete from booster_openings where created_at < now() - interval '3 days';
  get diagnostics v_open = row_count;
  delete from game_events where created_at < now() - interval '40 days';
  get diagnostics v_events = row_count;
  delete from arena_matches where status = 'abandoned' and created_at < now() - interval '7 days';
  get diagnostics v_matches = row_count;
  update arena_matches set status = 'abandoned', finished_at = now()
    where mode = 'pvp' and status = 'live' and created_at < now() - interval '1 hour';
  get diagnostics v_pvp = row_count;
  delete from arena_pvp_moves mv using arena_matches m where m.id = mv.match_id and m.status <> 'live' and m.created_at < now() - interval '2 days';
  delete from arena_queue where seen_at < now() - interval '10 minutes';
  return jsonb_build_object('ouvertures', v_open, 'evenements', v_events, 'matchs_abandonnes', v_matches, 'pvp_abandonnes', v_pvp);
end $$;

-- -----------------------------------------------------------------------------
-- 7. DROITS
-- -----------------------------------------------------------------------------
revoke execute on function public._pvp_squad(uuid, jsonb), public._pvp_json(public.arena_matches, uuid), public._pvp_current(uuid),
  public._arena_reward(uuid, uuid, boolean, boolean), public._pvp_close(uuid, uuid, uuid, int, int, jsonb, jsonb),
  public._pvp_forfeit_mine(uuid), public._pvp_pair(uuid), public.footx_cleanup() from public, anon, authenticated;
revoke execute on function public.arena_queue_join(jsonb), public.arena_queue_poll(), public.arena_queue_leave(),
  public.arena_pvp_wait(uuid, int, text), public.arena_pvp_move(uuid, int, text, boolean), public.arena_pvp_qte(uuid, int, text),
  public.arena_pvp_finish(uuid, int, int, boolean, int, jsonb) from public, anon;
grant execute on function public.arena_queue_join(jsonb), public.arena_queue_poll(), public.arena_queue_leave(),
  public.arena_pvp_wait(uuid, int, text), public.arena_pvp_move(uuid, int, text, boolean), public.arena_pvp_qte(uuid, int, text),
  public.arena_pvp_finish(uuid, int, int, boolean, int, jsonb) to authenticated;
