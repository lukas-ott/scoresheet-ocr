create table public.saved_games (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  pgn text not null check (octet_length(pgn) between 1 and 65536),
  created_at timestamptz not null default now()
);

create index saved_games_owner_date on public.saved_games (owner_id, created_at desc);

alter table public.saved_games enable row level security;
revoke all on public.saved_games from anon, authenticated;
grant select, delete on public.saved_games to authenticated;
grant insert (id, title, pgn) on public.saved_games to authenticated;

create policy "Read own games" on public.saved_games
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Save own games" on public.saved_games
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Delete own games" on public.saved_games
  for delete to authenticated using ((select auth.uid()) = owner_id);
