-- =============================================================================
-- FootX TCG — PACK DE DÉPART JOUABLE
-- Dépend de 20261110_sauvegarde.sql. Peut être relancée sans risque.
--
-- Le pack de bienvenue (10 cartes) contient maintenant une équipe complète pour
-- l'Arène : 1 gardien, 2 défenseurs/milieux, 2 attaquants (plutôt Communes ou
-- Atypiques), puis 5 cartes au hasard. Avant, un nouveau joueur sans gardien ne
-- pouvait pas jouer avant d'avoir ouvert des boosters.
-- Ne concerne que les NOUVEAUX comptes (ou tous après la remise à zéro du lancement).
-- =============================================================================

-- Poste → rôle 5v5 (mêmes règles que roleOf() dans src/lib/collectif.js)
create or replace function public._role_of(p text) returns text
language sql immutable as $$
  select case
    when x ~ '^(gb|g|gk|gar|gardien|goal)' then 'GK'
    when x ~ '^(att|bu|avc|ail|aig|aid|st|cf|lw|rw|ss|fw|lf|rf|ap)' and x !~ '^(lwb|rwb)' then 'ATT'
    when x ~ '^(def|dc|dg|dd|dl|lat|cb|lb|rb|lwb|rwb|sw|mil|mdc|mc|moc|mg|md|cdm|cm|cam|lm|rm|dm|am|m$)' then 'MID'
    else '?' end
  from (select lower(btrim(coalesce(p, ''))) as x) s
$$;

create or replace function public._welcome_pack() returns trigger
language plpgsql security definer set search_path = public as $$
declare s economy_settings; v_ids bigint[] := '{}';
begin
  select * into s from economy_settings;
  insert into user_boosters(user_id, stock) values (new.id, s.booster_start) on conflict (user_id) do nothing;

  -- une équipe jouable : 1 gardien, 2 déf/milieux, 2 attaquants (Communes/Atypiques en priorité)
  v_ids := v_ids || array(select id from cards where _role_of(position) = 'GK'  order by (_rrank(rarity) <= 1) desc, random() limit 1);
  v_ids := v_ids || array(select id from cards where _role_of(position) = 'MID' order by (_rrank(rarity) <= 1) desc, random() limit 2);
  v_ids := v_ids || array(select id from cards where _role_of(position) = 'ATT' order by (_rrank(rarity) <= 1) desc, random() limit 2);
  -- le reste au hasard
  v_ids := v_ids || array(select id from cards where not (id = any(v_ids)) order by random()
                          limit greatest(0, s.welcome_cards - cardinality(v_ids)));

  insert into user_cards(owner_id, card_id, source) select new.id, unnest(v_ids), 'reward';
  return new;
end $$;

revoke execute on function public._welcome_pack() from public, anon, authenticated;
