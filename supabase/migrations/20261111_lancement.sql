-- =============================================================================
-- FootX TCG — PRÊT POUR DES CENTAINES DE JOUEURS
-- Dépend de 20261110_sauvegarde.sql. Peut être relancée sans risque.
--
--   1. Historique des ouvertures de boosters 20× plus léger (base gratuite = 500 Mo)
--   2. Ménage automatique chaque nuit (journaux techniques anciens)
--   3. Index pour que la liste d'amis et les profils restent rapides
--   4. Droits resserrés : un joueur ne peut plus modifier sa série / son elo, ni écrire
--      une compo de Ligue sans passer par les contrôles du serveur
--   5. Tâches planifiées installées automatiquement si pg_cron est activé
--      (Database > Extensions > pg_cron) : clôture des enchères + ménage
-- =============================================================================

-- 1. Ouverture de booster : l'historique ne garde plus que les identifiants
create or replace function public.open_boosters(p_n int, p_request_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); s economy_settings; b user_boosters; o booster_openings;
  v_pools jsonb; v_si int; v_se int; v_feat text; v_forced text; v_rar text; v_cid bigint; v_uc uuid;
  v_cards jsonb := '[]'::jsonb; v_log jsonb := '[]'::jsonb; v_forced_list jsonb := '[]'::jsonb; i int; j int;
begin
  perform _ensure_profile(v_uid);
  if p_n is null or p_n not between 1 and 10 then raise exception 'Quantité invalide' using hint = 'invalid'; end if;
  if p_request_id is null or char_length(p_request_id) not between 4 and 80 then raise exception 'Requête invalide' using hint = 'invalid'; end if;
  select * into s from economy_settings;
  b := _booster_row(v_uid);                                     -- verrou : un seul tirage à la fois par joueur

  select * into o from booster_openings where user_id = v_uid and request_id = p_request_id;
  if o.id is not null then                                      -- requête rejouée (réseau coupé…) : même résultat
    return jsonb_build_object('cards',
      (select coalesce(jsonb_agg(jsonb_build_object('uid', e ->> 'uid', 'pack', (e ->> 'pack')::int, 'card', to_jsonb(c)) order by n), '[]'::jsonb)
         from jsonb_array_elements(o.cards) with ordinality x(e, n) join cards c on c.id = (e ->> 'card_id')::bigint),
      'forced', o.forced, 'replay', true, 'state', _booster_json(v_uid));
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
      v_log := v_log || jsonb_build_array(jsonb_build_object('uid', v_uc, 'pack', i, 'card_id', v_cid));   -- historique compact
    end loop;
  end loop;

  perform _set_stock(v_uid, b, b.stock - p_n);
  update user_boosters set pity_iconic = v_si, pity_epic = v_se, opened = opened + p_n where user_id = v_uid;
  insert into booster_openings(user_id, request_id, n, cards, forced) values (v_uid, p_request_id, p_n, v_log, v_forced_list);
  perform record_event(v_uid, 'booster_opened', p_n, '{}'::jsonb);   -- défis "Ouvre 1 booster"…
  return jsonb_build_object('cards', v_cards, 'forced', v_forced_list, 'replay', false, 'state', _booster_json(v_uid));
end $$;

-- les ouvertures déjà enregistrées : on ne garde que l'essentiel
update public.booster_openings
  set cards = (select coalesce(jsonb_agg(jsonb_build_object('uid', e ->> 'uid', 'pack', e -> 'pack', 'card_id', coalesce(e -> 'card' ->> 'id', e ->> 'card_id'))), '[]'::jsonb)
               from jsonb_array_elements(cards) e)
  where cards -> 0 ? 'card';

-- 2. Ménage : ce qui ne sert plus à rien après quelques jours
create or replace function public.footx_cleanup() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_open int; v_events int; v_matches int;
begin
  -- l'historique des ouvertures ne sert qu'à rejouer une requête coupée par le réseau
  delete from booster_openings where created_at < now() - interval '3 days';
  get diagnostics v_open = row_count;
  -- journal des actions : les défis sont déjà comptés dans user_quests
  delete from game_events where created_at < now() - interval '40 days';
  get diagnostics v_events = row_count;
  -- matchs contre l'IA abandonnés (onglet fermé en plein match)
  delete from arena_matches where status = 'abandoned' and created_at < now() - interval '7 days';
  get diagnostics v_matches = row_count;
  return jsonb_build_object('ouvertures', v_open, 'evenements', v_events, 'matchs_abandonnes', v_matches);
end $$;
revoke execute on function public.footx_cleanup() from public, anon, authenticated;

-- 3. Index (stats d'amis : victoires, matchs joués)
create index if not exists arena_matches_winner_idx on public.arena_matches(winner_id) where winner_id is not null;
create index if not exists arena_matches_away_idx   on public.arena_matches(away_id) where away_id is not null;
create index if not exists booster_openings_at_idx  on public.booster_openings(created_at);
create index if not exists game_events_at_idx       on public.game_events(created_at);
create index if not exists user_cards_owner_card_idx on public.user_cards(owner_id, card_id);

-- 4. Droits : tout passe par les fonctions du serveur
revoke update on public.profiles from anon, authenticated;                       -- série, elo, code ami…
revoke insert, update, delete on public.lineups, public.lineup_cards from anon, authenticated;   -- league_lock()

-- 5. Tâches planifiées (seulement si l'extension pg_cron est activée ; sinon, message et on continue)
do $$
begin
  perform cron.schedule('market-settle', '* * * * *', 'select public.settle_expired_listings()');
  perform cron.schedule('footx-cleanup', '17 4 * * *', 'select public.footx_cleanup()');
  raise notice 'Tâches planifiées installées (enchères chaque minute, ménage chaque nuit à 4h17 UTC).';
exception when others then
  raise notice 'pg_cron n''est pas activé : active-le dans Database > Extensions, puis relance cette migration.';
end $$;

select case when to_regclass('cron.job') is not null then 'pg_cron actif : tâches planifiées installées'
            else 'pg_cron pas encore activé : active-le (Database > Extensions) puis relance ce fichier' end as "tâches planifiées";
