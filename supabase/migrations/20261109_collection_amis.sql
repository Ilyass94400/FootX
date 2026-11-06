-- =============================================================================
-- FootX TCG — Collection par club + Amis
-- Dépend de 20261104 (profiles, cards, user_cards, arena_matches).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. COLLECTION : le catalogue des clubs (une ligne par club, en une requête)
--    rarities = {"commune": 12, "rare": 4, …}
-- -----------------------------------------------------------------------------
create or replace view public.club_catalogue with (security_invoker = true) as
with c as (
  select btrim(club) as club, country, lower(translate(coalesce(rarity, 'commune'), 'ÉéÈèÊêËë', 'EeEeEeEe')) as rarity
    from public.cards where club is not null and btrim(club) <> ''
), r as (
  select club, rarity, count(*)::int as n from c group by club, rarity
), k as (
  select club, mode() within group (order by country) as country, count(*)::int as total from c group by club
)
select trim(both '-' from regexp_replace(lower(translate(k.club,
         'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿ', 'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyy')), '[^a-z0-9]+', '-', 'g')) as club_key,
       k.club, k.country, k.total,
       (select jsonb_object_agg(r.rarity, r.n) from r where r.club = k.club) as rarities
  from k;
grant select on public.club_catalogue to anon, authenticated;
create index if not exists cards_club_idx on public.cards(club);

-- -----------------------------------------------------------------------------
-- 2. AMIS
-- -----------------------------------------------------------------------------
-- Code ami unique (FX-XXXX-XXXX) et présence (dernière visite)
alter table public.profiles add column if not exists friend_code text;
alter table public.profiles add column if not exists last_seen timestamptz;

create or replace function public._new_friend_code() returns text
language plpgsql volatile as $$
declare c text;
begin
  loop
    c := 'FX-' || upper(substr(md5(random()::text), 1, 4)) || '-' || upper(substr(md5(random()::text), 1, 4));
    exit when not exists (select 1 from public.profiles where friend_code = c);
  end loop;
  return c;
end $$;

update public.profiles set friend_code = public._new_friend_code() where friend_code is null;
create unique index if not exists profiles_friend_code_idx on public.profiles(friend_code);
create index if not exists profiles_username_lower_idx on public.profiles(lower(username));

create or replace function public._profiles_friend_code() returns trigger
language plpgsql as $$
begin
  if new.friend_code is null then new.friend_code := public._new_friend_code(); end if;
  return new;
end $$;
drop trigger if exists profiles_friend_code on public.profiles;
create trigger profiles_friend_code before insert on public.profiles for each row execute function public._profiles_friend_code();

-- Une ligne par paire de joueurs (dans un seul sens), "pending" puis "accepted".
create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  check (requester_id <> addressee_id)
);
create unique index if not exists friendships_pair_idx on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_addressee_idx on public.friendships(addressee_id, status);

alter table public.friendships enable row level security;
drop policy if exists "mes amitiés" on public.friendships;
create policy "mes amitiés" on public.friendships for select using (auth.uid() in (requester_id, addressee_id));
revoke insert, update, delete on public.friendships from anon, authenticated;

-- Moi : mon code ami (et je signale ma présence)
create or replace function public.friends_me()
returns table (id uuid, username text, avatar_url text, friend_code text)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  update profiles p set last_seen = now(), friend_code = coalesce(p.friend_code, _new_friend_code()) where p.id = auth.uid();
  return query select p.id, p.username, p.avatar_url, p.friend_code from profiles p where p.id = auth.uid();
end $$;

-- Envoyer une demande par code ami (FX-XXXX-XXXX) ou pseudo exact.
-- Si l'autre m'avait déjà demandé, la demande est acceptée directement.
create or replace function public.friend_request(p_query text)
returns text language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_target uuid; v_n int; f friendships;
begin
  if v_me is null then raise exception 'Non connecté'; end if;
  p_query := btrim(coalesce(p_query, ''));
  if char_length(p_query) < 3 then raise exception 'Entre un code ami ou un pseudo.'; end if;
  if p_query ~* '^FX-[0-9A-Z]{4}-[0-9A-Z]{4}$' then
    select id into v_target from profiles where friend_code = upper(p_query);
  else
    select count(*), min(id::text)::uuid into v_n, v_target from profiles where lower(username) = lower(p_query);
    if v_n > 1 then raise exception 'Plusieurs joueurs portent ce pseudo : utilise son code ami.'; end if;
  end if;
  if v_target is null then raise exception 'Joueur introuvable'; end if;
  if v_target = v_me then raise exception 'C''est ton propre code !'; end if;
  if (select count(*) from friendships where requester_id = v_me and status = 'pending') >= 50 then raise exception 'Trop de demandes en attente.'; end if;
  if (select count(*) from friendships where v_me in (requester_id, addressee_id) and status = 'accepted') >= 200 then raise exception 'Tu as déjà 200 amis.'; end if;
  select * into f from friendships where least(requester_id, addressee_id) = least(v_me, v_target) and greatest(requester_id, addressee_id) = greatest(v_me, v_target) for update;
  if f.id is not null then
    if f.status = 'accepted' then raise exception 'Vous êtes déjà amis.'; end if;
    if f.requester_id = v_me then raise exception 'Demande déjà envoyée.'; end if;
    update friendships set status = 'accepted', accepted_at = now() where id = f.id;
    return 'accepted';
  end if;
  insert into friendships(requester_id, addressee_id) values (v_me, v_target);
  return 'sent';
end $$;

-- Répondre à une demande reçue
create or replace function public.friend_respond(p_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_accept then
    update friendships set status = 'accepted', accepted_at = now() where id = p_id and addressee_id = auth.uid() and status = 'pending';
  else
    delete from friendships where id = p_id and addressee_id = auth.uid() and status = 'pending';
  end if;
  if not found then raise exception 'Demande introuvable'; end if;
end $$;

-- Retirer un ami / annuler une demande envoyée
create or replace function public.friend_remove(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from friendships where id = p_id and auth.uid() in (requester_id, addressee_id);
  if not found then raise exception 'Introuvable'; end if;
end $$;

-- Ma liste : amis, demandes reçues, demandes envoyées (+ quelques stats publiques)
create or replace function public.friends_list()
returns table (id uuid, status text, since timestamptz, user_id uuid, username text, avatar_url text, friend_code text, last_seen timestamptz, wins int, matches int, cards int)
language sql stable security definer set search_path = public as $$
  select f.id,
         case when f.status = 'accepted' then 'accepted' when f.requester_id = auth.uid() then 'outgoing' else 'incoming' end,
         coalesce(f.accepted_at, f.created_at), p.id, p.username, p.avatar_url,
         case when f.status = 'accepted' then p.friend_code end,       -- le code n'est révélé qu'aux amis
         case when f.status = 'accepted' then p.last_seen end,
         case when f.status = 'accepted' then (select count(*)::int from arena_matches m where m.winner_id = p.id) end,
         case when f.status = 'accepted' then (select count(*)::int from arena_matches m where p.id in (m.home_id, m.away_id) and m.status = 'finished') end,
         case when f.status = 'accepted' then (select count(*)::int from user_cards u where u.owner_id = p.id) end
    from friendships f
    join profiles p on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
   where auth.uid() in (f.requester_id, f.addressee_id)
   order by f.status, p.last_seen desc nulls last
$$;

-- Profil d'un ami (refusé si vous n'êtes pas amis) : stats, 5 meilleurs joueurs, clubs favoris
create or replace function public.friend_profile(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p profiles;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if p_user <> auth.uid() and not exists (
    select 1 from friendships where status = 'accepted'
       and least(requester_id, addressee_id) = least(auth.uid(), p_user) and greatest(requester_id, addressee_id) = greatest(auth.uid(), p_user)) then
    raise exception 'Vous n''êtes pas amis';
  end if;
  select * into p from profiles where id = p_user;
  return jsonb_build_object(
    'username', p.username, 'avatar_url', p.avatar_url, 'friend_code', p.friend_code, 'elo', p.elo,
    'wins', (select count(*) from arena_matches m where m.winner_id = p.id),
    'matches', (select count(*) from arena_matches m where p.id in (m.home_id, m.away_id) and m.status = 'finished'),
    'cards', (select count(*) from user_cards u where u.owner_id = p.id),
    'unique', (select count(distinct u.card_id) from user_cards u where u.owner_id = p.id),
    'best', coalesce((select jsonb_agg(to_jsonb(x) - 'rk' order by x.rk desc, x.name) from (
        select c.*, case lower(translate(c.rarity, 'Éé', 'Ee')) when 'iconique' then 5 when 'legendaire' then 4 when 'epique' then 3 when 'rare' then 2 when 'atypique' then 1 else 0 end as rk
          from cards c where c.id in (select u.card_id from user_cards u where u.owner_id = p.id)
         order by rk desc, c.name limit 5) x), '[]'::jsonb),
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('club', t.club, 'n', t.n) order by t.n desc) from (
        select btrim(c.club) as club, count(distinct c.id)::int as n from user_cards u join cards c on c.id = u.card_id
         where u.owner_id = p.id and c.club is not null group by btrim(c.club) order by n desc limit 5) t), '[]'::jsonb)
  );
end $$;

revoke execute on function public._new_friend_code() from public, anon, authenticated;
revoke execute on function public.friends_me(), public.friend_request(text), public.friend_respond(uuid, boolean), public.friend_remove(uuid),
  public.friends_list(), public.friend_profile(uuid) from public, anon;
grant execute on function public.friends_me(), public.friend_request(text), public.friend_respond(uuid, boolean), public.friend_remove(uuid),
  public.friends_list(), public.friend_profile(uuid) to authenticated;
