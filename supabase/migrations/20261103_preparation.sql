-- =============================================================================
-- FootX TCG — PRÉPARATION (à exécuter UNE FOIS, AVANT 20261104_arene_ligue.sql)
--
-- Ta base contenait déjà des tables portant les mêmes noms que celles de FootX
-- (ex. user_cards), créées au début du projet avec d'autres colonnes.
-- Ce script les MET DE CÔTÉ en les renommant "<nom>_avant_footx" : aucune donnée
-- n'est supprimée. Les tables déjà conformes ne sont pas touchées.
-- Il peut être relancé sans risque.
-- =============================================================================
create temp table if not exists footx_prep (etape text, detail text);
truncate footx_prep;

do $$
declare
  v_type text; r record; v_missing text[]; v_new text; i record; v_n int;
begin
  -- 1. Le catalogue : les migrations supposent que cards.id est un nombre entier
  select data_type into v_type from information_schema.columns
    where table_schema = 'public' and table_name = 'cards' and column_name = 'id';
  if v_type is null then
    raise exception 'Table public.cards introuvable : crée d''abord ton catalogue de cartes.';
  elsif v_type not in ('bigint', 'integer', 'smallint') then
    raise exception 'cards.id est de type % : les migrations attendent un nombre entier. Envoie ce message à Claude.', v_type;
  end if;
  insert into footx_prep values ('Catalogue', 'cards.id = ' || v_type || ' : OK');

  -- 2. Tables existantes qui n'ont pas la forme attendue → mises de côté
  for r in select * from (values
    ('profiles', array['id', 'username', 'avatar_url', 'elo', 'win_streak', 'created_at']),
    ('user_cards', array['id', 'owner_id', 'card_id', 'source', 'obtained_at']),
    ('squads', array['owner_id', 'gk', 'd1', 'd2', 'a1', 'a2', 'updated_at']),
    ('arena_queue', array['user_id', 'elo', 'joined_at']),
    ('arena_matches', array['id', 'home_id', 'away_id', 'seed', 'engine_version', 'home_squad', 'away_squad', 'status', 'action_idx', 'home_score', 'away_score', 'winner_id', 'created_at', 'finished_at']),
    ('arena_moves', array['match_id', 'action_idx', 'player_id', 'commit_hash', 'choice', 'salt', 'qte_ms', 'committed_at', 'revealed_at']),
    ('leagues', array['id', 'name', 'owner_id', 'invite_code', 'season', 'created_at']),
    ('league_members', array['league_id', 'user_id', 'joined_at']),
    ('gameweeks', array['id', 'season', 'number', 'deadline', 'ends_at', 'status']),
    ('player_gameweek_stats', array['gameweek_id', 'real_player_ref', 'played', 'sub', 'goals', 'assists', 'shots', 'clean', 'saves', 'conceded', 'yellow', 'red', 'own_goal', 'updated_at']),
    ('lineups', array['user_id', 'gameweek_id', 'captain_slot', 'locked_at', 'total_points']),
    ('lineup_cards', array['user_id', 'gameweek_id', 'slot', 'user_card_id', 'rarity', 'points', 'breakdown']),
    ('economy_rarity', array['rarity', 'quicksell', 'min_price', 'max_price']),
    ('economy_settings', array['id', 'start_balance', 'match_win', 'match_loss', 'match_daily_cap', 'booster_price', 'market_tax_pct', 'bid_step_pct', 'anti_snipe_sec', 'max_listings']),
    ('user_balances', array['user_id', 'balance', 'updated_at']),
    ('transactions_history', array['id', 'user_id', 'amount', 'balance_after', 'kind', 'ref_id', 'idempotency_key', 'created_at']),
    ('user_boosters', array['user_id', 'stock']),
    ('market_listings', array['id', 'seller_id', 'user_card_id', 'card_id', 'card_name', 'rarity', 'position', 'club', 'country', 'start_price', 'buy_now_price', 'current_bid', 'current_bidder', 'bid_count', 'status', 'created_at', 'ends_at', 'settled_at', 'buyer_id', 'final_price']),
    ('market_bids', array['id', 'listing_id', 'bidder_id', 'amount', 'created_at']),
    ('quest_templates', array['id', 'category', 'title', 'description', 'event_type', 'target', 'mode', 'filter', 'reward_coins', 'reward_boosters', 'icon', 'sort', 'active']),
    ('quest_settings', array['id', 'daily_slots', 'timezone']),
    ('user_quests', array['user_id', 'template_id', 'period_key', 'progress', 'completed_at', 'claimed_at']),
    ('game_events', array['id', 'user_id', 'type', 'amount', 'payload', 'created_at']),
    ('career_talents', array['id', 'label', 'bonus', 'xp_bonus', 'trait']),
    ('career_skill_nodes', array['id', 'branch', 'tier', 'kind', 'stat', 'amount', 'trait', 'ultimate', 'cost', 'level_req', 'requires', 'max_rank']),
    ('career_save', array['user_id', 'player_name', 'shirt_number', 'position', 'country', 'appearance', 'talent', 'xp', 'club_key', 'club_name', 'season', 'phase', 'contract_until', 'wage', 'role', 'seed', 'live_fixture', 'live_started_at', 'created_at', 'updated_at']),
    ('career_skills', array['user_id', 'node_id', 'rank', 'unlocked_at']),
    ('career_stats', array['user_id', 'season', 'club_key', 'club_name', 'played', 'wins', 'goals', 'perfect_qte', 'rating_sum', 'best_rating', 'motm', 'xp', 'market_score', 'closed_at']),
    ('career_fixtures', array['id', 'user_id', 'season', 'round', 'opp_key', 'opp_name', 'is_home', 'big', 'result', 'rating', 'xp', 'played_at']),
    ('career_offers', array['id', 'user_id', 'season', 'kind', 'club_key', 'club_name', 'tier', 'wage', 'years', 'role', 'bonus', 'status', 'created_at', 'answered_at']),
    ('friendships', array['id', 'requester_id', 'addressee_id', 'status', 'created_at', 'accepted_at'])
  ) t(tbl, cols) loop
    if to_regclass('public.' || r.tbl) is null then continue; end if;
    select array_agg(c) into v_missing from unnest(r.cols) c
      where not exists (select 1 from information_schema.columns
                        where table_schema = 'public' and table_name = r.tbl and column_name = c);
    if v_missing is null then
      insert into footx_prep values (r.tbl, 'déjà conforme, gardée telle quelle');
      continue;
    end if;
    v_new := r.tbl || '_avant_footx'; v_n := 1;
    while to_regclass('public.' || v_new) is not null loop
      v_n := v_n + 1; v_new := r.tbl || '_avant_footx' || v_n;
    end loop;
    -- index et séquences renommés aussi (sinon leurs noms bloqueraient les nouvelles tables)
    for i in select ic.relname from pg_index x join pg_class ic on ic.oid = x.indexrelid
             where x.indrelid = ('public.' || r.tbl)::regclass loop
      execute format('alter index public.%I rename to %I', i.relname, left(i.relname || '_avant_footx' || case when v_n > 1 then v_n::text else '' end, 63));
    end loop;
    for i in select s.relname from pg_class s join pg_depend dp on dp.objid = s.oid
             where s.relkind = 'S' and dp.refobjid = ('public.' || r.tbl)::regclass and dp.deptype in ('a', 'i') loop
      execute format('alter sequence public.%I rename to %I', i.relname, left(i.relname || '_avant_footx' || case when v_n > 1 then v_n::text else '' end, 63));
    end loop;
    execute format('alter table public.%I rename to %I', r.tbl, v_new);
    insert into footx_prep values (r.tbl, 'ancienne version renommée en ' || v_new || ' (colonnes manquantes : ' || array_to_string(v_missing, ', ') || ')');
  end loop;
end $$;

select etape as "table", detail as "résultat" from footx_prep;
