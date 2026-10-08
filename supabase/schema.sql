-- PsyConnect database schema. Run once in Supabase > SQL Editor.
-- Safe to re-run.

create table if not exists public.user_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_state_size check (pg_column_size(state) < 1048576)
);

alter table public.user_state enable row level security;

drop policy if exists "user_state_select_own" on public.user_state;
drop policy if exists "user_state_insert_own" on public.user_state;
drop policy if exists "user_state_update_own" on public.user_state;
drop policy if exists "user_state_delete_own" on public.user_state;

create policy "user_state_select_own" on public.user_state
  for select to authenticated using (auth.uid() = user_id);
create policy "user_state_insert_own" on public.user_state
  for insert to authenticated with check (auth.uid() = user_id);
create policy "user_state_update_own" on public.user_state
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_state_delete_own" on public.user_state
  for delete to authenticated using (auth.uid() = user_id);

revoke all on public.user_state from anon;
grant select, insert, update, delete on public.user_state to authenticated;

-- Lets a signed-in user delete their own account and (via cascade) all their data.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
