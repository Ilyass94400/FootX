-- =============================================================================
-- FootX TCG — Défis (quotidiens, hebdomadaires, carrière)
-- Dépend de 20261104_arene_ligue.sql et 20261105_economie.sql.
--
-- PRINCIPE : le client ne peut PAS faire avancer un défi lui-même.
-- La progression est alimentée par des ÉVÉNEMENTS écrits côté serveur :
--   - des TRIGGERS sur les tables qui font foi (match terminé, vente conclue, compo
--     verrouillée, cartes possédées…) ;
--   - des Edge Functions (ouverture de booster, sauvegarde de compo) qui appellent
--     record_event() avec la clé service_role.
-- Le client ne fait que LIRE ses défis (get_my_quests) et RÉCLAMER (claim_quest).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CATALOGUE
-- -----------------------------------------------------------------------------
create table if not exists public.quest_templates (
  id              text primary key,
  category        text not null check (category in ('daily','weekly','milestone')),
  title           text not null,
  description     text not null,
  event_type      text not null,
  target          int  not null check (target > 0),
  mode            text not null default 'inc' check (mode in ('inc','max')),  -- inc : on additionne · max : meilleure valeur
  filter          jsonb not null default '{}'::jsonb,                          -- ex. {"country":"France"} : payload @> filter
  reward_coins    bigint not null default 0 check (reward_coins >= 0),
  reward_boosters int not null default 0 check (reward_boosters between 0 and 10),
  icon            text,
  sort            int not null default 0,
  active          boolean not null default true
);
create index if not exists quest_templates_event_idx on public.quest_templates(event_type) where active;

insert into public.quest_templates(id, category, title, description, event_type, target, mode, filter, reward_coins, reward_boosters, icon, sort) values
  ('d_play3', 'daily', 'Échauffement', 'Joue 3 matchs dans l''Arène', 'match_played', 3, 'inc', '{}'::jsonb, 300, 0, 'ball', 0),
  ('d_win1', 'daily', 'Premier sang', 'Gagne 1 match d''Arène', 'match_won', 1, 'inc', '{}'::jsonb, 250, 0, 'trophy', 1),
  ('d_goals3', 'daily', 'Buteur du jour', 'Marque 3 buts dans l''Arène', 'goal_scored', 3, 'inc', '{}'::jsonb, 300, 0, 'boot', 2),
  ('d_perfect2', 'daily', 'Sang-froid', 'Réussis 2 timings parfaits', 'perfect_qte', 2, 'inc', '{}'::jsonb, 250, 0, 'target', 3),
  ('d_booster1', 'daily', 'Déchire-le', 'Ouvre 1 booster', 'booster_opened', 1, 'inc', '{}'::jsonb, 150, 0, 'pack', 4),
  ('d_buy1', 'daily', 'Mercato', 'Achète un joueur sur le Marché', 'market_buy', 1, 'inc', '{}'::jsonb, 200, 0, 'cart', 5),
  ('d_list1', 'daily', 'Vitrine', 'Mets une carte en vente sur le Marché', 'market_list', 1, 'inc', '{}'::jsonb, 150, 0, 'tag', 6),
  ('w_win10', 'weekly', 'Série en cours', 'Gagne 10 matchs d''Arène', 'match_won', 10, 'inc', '{}'::jsonb, 2500, 1, 'trophy', 7),
  ('w_goals_fr', 'weekly', 'Les Bleus', 'Marque 5 buts avec des joueurs français', 'goal_scored', 5, 'inc', '{"country":"France"}'::jsonb, 1500, 0, 'flag', 8),
  ('w_league', 'weekly', 'Coach du week-end', 'Verrouille ta composition de Ligue', 'league_lock', 1, 'inc', '{}'::jsonb, 1000, 0, 'lock', 9),
  ('w_boosters10', 'weekly', 'Collectionneur', 'Ouvre 10 boosters', 'booster_opened', 10, 'inc', '{}'::jsonb, 1000, 0, 'pack', 10),
  ('w_sales3', 'weekly', 'Agent de joueurs', 'Vends 3 cartes sur le Marché', 'market_sale', 3, 'inc', '{}'::jsonb, 1200, 0, 'coins', 11),
  ('m_first_win', 'milestone', 'Première victoire', 'Gagne ton premier match d''Arène', 'match_won', 1, 'inc', '{}'::jsonb, 500, 0, 'trophy', 12),
  ('m_chem3', 'milestone', 'Connexion parfaite', 'Aligne un joueur avec un collectif de 3/3', 'team_chem', 3, 'max', '{}'::jsonb, 1000, 0, 'link', 13),
  ('m_chem15', 'milestone', 'Onze… cinq de légende', 'Atteins un collectif d''équipe parfait de 15/15', 'team_chem_total', 15, 'max', '{}'::jsonb, 5000, 1, 'link', 14),
  ('m_legend10', 'milestone', 'Panthéon', 'Possède 10 joueurs Légendaires', 'collection_legendaire', 10, 'max', '{}'::jsonb, 5000, 0, 'star', 15),
  ('m_transfers10', 'milestone', 'Directeur sportif', 'Réalise 10 achats sur le Marché', 'market_buy', 10, 'inc', '{}'::jsonb, 3000, 0, 'cart', 16),
  ('m_wins100', 'milestone', 'Centurion', 'Atteins 100 victoires en Arène', 'match_won', 100, 'inc', '{}'::jsonb, 20000, 2, 'crown', 17),
  ('m_iconic50', 'milestone', 'Musée vivant', 'Possède 50 joueurs Iconiques', 'collection_iconique', 50, 'max', '{}'::jsonb, 25000, 3, 'crown', 18)
on conflict (id) do update set category = excluded.category, title = excluded.title, description = excluded.description,
  event_type = excluded.event_type, target = excluded.target, mode = excluded.mode, filter = excluded.filter,
  reward_coins = excluded.reward_coins, reward_boosters = excluded.reward_boosters, icon = excluded.icon, sort = excluded.sort;

create table if not exists public.quest_settings (
  id          boolean primary key default true check (id),
  daily_slots int  not null default 3,
  timezone    text not null default 'Europe/Paris'        -- les quotidiens changent à minuit heure de Paris
);
insert into public.quest_settings default values on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. PROGRESSION DES JOUEURS
--    Une ligne par joueur × défi × PÉRIODE ('2026-11-05', '2026-W45', 'career').
--    La période dans la clé = la réinitialisation est gratuite : demain, ce sont
--    simplement de nouvelles lignes. L'historique reste consultable.
-- -----------------------------------------------------------------------------
create table if not exists public.user_quests (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  template_id  text not null references public.quest_templates(id),
  period_key   text not null,
  progress     int  not null default 0 check (progress >= 0),
  completed_at timestamptz,
  claimed_at   timestamptz,
  primary key (user_id, template_id, period_key),
  check (claimed_at is null or completed_at is not null)       -- impossible de réclamer un défi non terminé
);
create index if not exists user_quests_open_idx on public.user_quests(user_id) where claimed_at is null;

-- Journal des événements de jeu (audit, rejouabilité, nouveaux défis rétroactifs).
create table if not exists public.game_events (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  amount     int  not null default 1,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists game_events_user_idx on public.game_events(user_id, created_at desc);

-- Les buts d'un match (écrits par l'Edge Function qui valide le match) : [{ "side":"home", "country":"France", "club":"PSG" }, …]
alter table public.arena_matches add column if not exists goal_log jsonb not null default '[]'::jsonb;
alter table public.arena_matches add column if not exists perfect_qte jsonb not null default '{}'::jsonb;  -- {"home":2,"away":1}

-- Nouveau type de mouvement dans le grand livre.
alter table public.transactions_history drop constraint if exists transactions_history_kind_check;
alter table public.transactions_history add constraint transactions_history_kind_check check (kind in ('start','match_reward','league_reward',
  'quicksell','booster','bid_hold','bid_refund','market_buy','market_sale','admin','quest_reward'));

-- -----------------------------------------------------------------------------
-- 3. SÉCURITÉ : lecture seule pour le joueur
-- -----------------------------------------------------------------------------
alter table public.quest_templates enable row level security;
alter table public.quest_settings  enable row level security;
alter table public.user_quests     enable row level security;
alter table public.game_events     enable row level security;
create policy "défis publics"    on public.quest_templates for select using (active);
create policy "réglages défis"   on public.quest_settings  for select using (true);
create policy "mes défis"        on public.user_quests     for select using (user_id = auth.uid());
create policy "mes événements"   on public.game_events     for select using (user_id = auth.uid());
revoke insert, update, delete on public.quest_templates, public.quest_settings, public.user_quests, public.game_events from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. LOGIQUE
-- -----------------------------------------------------------------------------
-- Clé de période d'un défi à un instant donné.
create or replace function public._quest_period(p_category text, p_at timestamptz default now())
returns text language sql stable set search_path = public as $$
  select case p_category
    when 'daily'  then to_char(p_at at time zone (select timezone from quest_settings), 'YYYY-MM-DD')
    when 'weekly' then to_char(p_at at time zone (select timezone from quest_settings), 'IYYY-"W"IW')   -- semaine ISO : commence le lundi
    else 'career' end
$$;

-- Crée les lignes du jour / de la semaine / de carrière si elles n'existent pas encore.
-- Quotidiens : N défis tirés au hasard, mais de façon FIXE pour un joueur et un jour donnés
-- (md5(joueur + jour + défi)) → recharger la page ne relance pas le tirage.
create or replace function public._ensure_quests(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_day text := _quest_period('daily');
begin
  insert into user_quests(user_id, template_id, period_key)
  select p_user, t.id, v_day from quest_templates t
   where t.active and t.category = 'daily'
   order by md5(p_user::text || v_day || t.id)
   limit (select daily_slots from quest_settings)
  on conflict do nothing;
  insert into user_quests(user_id, template_id, period_key)
  select p_user, t.id, _quest_period(t.category) from quest_templates t
   where t.active and t.category in ('weekly', 'milestone')
  on conflict do nothing;
end $$;

-- Cœur du système : un événement fait avancer tous les défis ouverts qui l'écoutent.
create or replace function public.record_event(p_user uuid, p_type text, p_amount int default 1, p_payload jsonb default '{}'::jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if p_user is null or p_amount is null or p_amount <= 0 then return 0; end if;
  insert into game_events(user_id, type, amount, payload) values (p_user, p_type, p_amount, coalesce(p_payload, '{}'::jsonb));
  perform _ensure_quests(p_user);
  update user_quests uq set
      progress = least(t.target, case t.mode when 'inc' then uq.progress + p_amount else greatest(uq.progress, p_amount) end),
      completed_at = case when uq.completed_at is null
                           and least(t.target, case t.mode when 'inc' then uq.progress + p_amount else greatest(uq.progress, p_amount) end) >= t.target
                          then now() else uq.completed_at end
    from quest_templates t
   where t.id = uq.template_id and t.active
     and uq.user_id = p_user
     and uq.completed_at is null
     and t.event_type = p_type
     and coalesce(p_payload, '{}'::jsonb) @> t.filter
     and uq.period_key = _quest_period(t.category);
  get diagnostics v_n = row_count;
  return v_n;                                   -- nombre de défis qui ont avancé
end $$;

-- Lecture pour l'interface (crée les défis du jour au passage).
create or replace function public.get_my_quests()
returns table (template_id text, category text, title text, description text, icon text, target int, progress int,
               reward_coins bigint, reward_boosters int, period_key text, completed_at timestamptz, claimed_at timestamptz, resets_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_tz text := (select timezone from quest_settings);
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  perform _ensure_quests(auth.uid());
  return query
  select t.id, t.category, t.title, t.description, t.icon, t.target, uq.progress, t.reward_coins, t.reward_boosters, uq.period_key,
         uq.completed_at, uq.claimed_at,
         case t.category
           when 'daily'  then (date_trunc('day',  now() at time zone v_tz) + interval '1 day')  at time zone v_tz
           when 'weekly' then (date_trunc('week', now() at time zone v_tz) + interval '7 days') at time zone v_tz
         end
    from user_quests uq join quest_templates t on t.id = uq.template_id
   where uq.user_id = auth.uid() and uq.period_key = _quest_period(t.category)
   order by t.category, (uq.completed_at is not null and uq.claimed_at is null) desc, uq.claimed_at nulls first, t.sort;
end $$;

-- Récupérer une récompense : une seule fois (verrou de ligne + clé d'idempotence du grand livre).
create or replace function public.claim_quest(p_template text, p_period text)
returns bigint language plpgsql security definer set search_path = public as $$
declare uq user_quests; t quest_templates; v_bal bigint; v_stock int;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  select * into uq from user_quests where user_id = auth.uid() and template_id = p_template and period_key = p_period for update;
  if uq.user_id is null then raise exception 'Défi introuvable'; end if;
  if uq.completed_at is null then raise exception 'Défi pas encore terminé' using hint = 'not_completed'; end if;
  if uq.claimed_at is not null then raise exception 'Récompense déjà récupérée' using hint = 'already_claimed'; end if;
  select * into t from quest_templates where id = p_template;
  if t.reward_boosters > 0 then
    select coalesce((select stock from user_boosters where user_id = auth.uid() for update), 0) into v_stock;
    if v_stock + t.reward_boosters > 10 then
      raise exception 'Stock de boosters plein : ouvre-en avant de récupérer' using hint = 'stock_full';
    end if;
    insert into user_boosters(user_id, stock) values (auth.uid(), t.reward_boosters)
      on conflict (user_id) do update set stock = user_boosters.stock + t.reward_boosters;
  end if;
  update user_quests set claimed_at = now() where user_id = auth.uid() and template_id = p_template and period_key = p_period;
  if t.reward_coins > 0 then
    v_bal := _move_coins(auth.uid(), t.reward_coins, 'quest_reward', p_template || ':' || p_period,
                         'quest:' || auth.uid() || ':' || p_template || ':' || p_period);
  else
    select balance into v_bal from user_balances where user_id = auth.uid();
  end if;
  return v_bal;
end $$;

-- -----------------------------------------------------------------------------
-- 5. TRIGGERS : la progression vient des tables qui font foi
-- -----------------------------------------------------------------------------
-- Fin de match d'Arène (le statut passe à 'finished', écrit par l'Edge Function de validation).
create or replace function public._quests_on_match() returns trigger
language plpgsql security definer set search_path = public as $$
declare g jsonb; p uuid;
begin
  if new.status <> 'finished' or old.status = 'finished' then return new; end if;
  foreach p in array array_remove(array[new.home_id, new.away_id], null) loop
    perform record_event(p, 'match_played', 1, jsonb_build_object('match', new.id));
    if new.winner_id = p then perform record_event(p, 'match_won', 1, jsonb_build_object('match', new.id)); end if;
    perform record_event(p, 'perfect_qte', coalesce((new.perfect_qte ->> case when p = new.home_id then 'home' else 'away' end)::int, 0), '{}'::jsonb);
  end loop;
  for g in select * from jsonb_array_elements(new.goal_log) loop
    p := case g ->> 'side' when 'home' then new.home_id else new.away_id end;
    perform record_event(p, 'goal_scored', 1, g);            -- payload {country, club, …} → filtres "joueurs français"
  end loop;
  return new;
end $$;
drop trigger if exists quests_on_match on public.arena_matches;
create trigger quests_on_match after update of status on public.arena_matches for each row execute function public._quests_on_match();

-- Marché : mise en vente, vente conclue.
create or replace function public._quests_on_listing() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform record_event(new.seller_id, 'market_list', 1, jsonb_build_object('rarity', new.rarity));
  elsif new.status = 'sold' and old.status <> 'sold' then
    perform record_event(new.buyer_id,  'market_buy',  1, jsonb_build_object('rarity', new.rarity, 'country', new.country, 'club', new.club));
    perform record_event(new.seller_id, 'market_sale', 1, jsonb_build_object('rarity', new.rarity));
  end if;
  return new;
end $$;
drop trigger if exists quests_on_listing on public.market_listings;
create trigger quests_on_listing after insert or update of status on public.market_listings for each row execute function public._quests_on_listing();

-- Ligue : composition verrouillée.
create or replace function public._quests_on_lineup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform record_event(new.user_id, 'league_lock', 1, jsonb_build_object('gameweek', new.gameweek_id));
  return new;
end $$;
drop trigger if exists quests_on_lineup on public.lineups;
create trigger quests_on_lineup after insert on public.lineups for each row execute function public._quests_on_lineup();

-- Collection : nombre de cartes possédées par rareté (mode 'max').
create or replace function public._quests_on_cards() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := coalesce(new.owner_id, old.owner_id); v_ico int; v_leg int;
begin
  select count(*) filter (where lower(c.rarity) = 'iconique'), count(*) filter (where lower(c.rarity) = 'legendaire')
    into v_ico, v_leg
    from user_cards uc join cards c on c.id = uc.card_id where uc.owner_id = v_owner;
  perform record_event(v_owner, 'collection_iconique', v_ico, '{}'::jsonb);
  perform record_event(v_owner, 'collection_legendaire', v_leg, '{}'::jsonb);
  return null;
end $$;
drop trigger if exists quests_on_cards on public.user_cards;
create trigger quests_on_cards after insert or update of owner_id on public.user_cards for each row execute function public._quests_on_cards();

-- Événements calculés ailleurs (ouverture de booster tirée côté serveur, collectif d'une compo
-- calculé avec chemistry.js) : l'Edge Function appelle record_event() avec la clé service_role.

-- -----------------------------------------------------------------------------
-- 6. DROITS
-- -----------------------------------------------------------------------------
revoke execute on function public.record_event(uuid, text, int, jsonb) from public, anon, authenticated;
revoke execute on function public._ensure_quests(uuid) from public, anon, authenticated;
revoke execute on function public._quests_on_match(), public._quests_on_listing(), public._quests_on_lineup(), public._quests_on_cards() from public, anon, authenticated;
revoke execute on function public.get_my_quests(), public.claim_quest(text, text) from public, anon;
grant execute on function public.get_my_quests(), public.claim_quest(text, text) to authenticated;

-- Temps réel : le badge "Défis" s'allume dès qu'un défi est terminé.
alter publication supabase_realtime add table public.user_quests;
