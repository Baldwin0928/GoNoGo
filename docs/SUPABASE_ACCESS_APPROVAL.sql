-- GoNoGo shared-board access approval
-- Run this in Supabase SQL Editor after the public.boards table exists.
-- Admin seed email: chaldwinben@gmail.com

create table if not exists public.board_members (
  id uuid primary key default gen_random_uuid(),
  board_id text not null references public.boards(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  role text not null default 'viewer' check (role in ('admin', 'editor', 'viewer')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id)
);

create unique index if not exists board_members_board_email_uidx
  on public.board_members (board_id, lower(email));

create or replace function public.current_user_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.is_board_member(target_board_id text, allowed_roles text[] default array['admin', 'editor', 'viewer'])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.board_members member
    where member.board_id = target_board_id
      and lower(member.email) = public.current_user_email()
      and member.status = 'approved'
      and member.role = any(allowed_roles)
  );
$$;

create or replace function public.is_board_admin(target_board_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_board_member(target_board_id, array['admin']);
$$;

alter table public.board_members enable row level security;
alter table public.boards enable row level security;

-- Replace older broad board policies, regardless of their names.
do $$
declare
  policy_name text;
begin
  for policy_name in
    select polname
    from pg_policy
    where polrelid = 'public.boards'::regclass
  loop
    execute format('drop policy if exists %I on public.boards', policy_name);
  end loop;
end $$;

do $$
declare
  policy_name text;
begin
  for policy_name in
    select polname
    from pg_policy
    where polrelid = 'public.board_members'::regclass
  loop
    execute format('drop policy if exists %I on public.board_members', policy_name);
  end loop;
end $$;

create policy "approved members can read board"
on public.boards
for select
to authenticated
using (public.is_board_member(id));

create policy "approved editors can update board"
on public.boards
for update
to authenticated
using (public.is_board_member(id, array['admin', 'editor']))
with check (public.is_board_member(id, array['admin', 'editor']));

create policy "approved editors can create board row"
on public.boards
for insert
to authenticated
with check (public.is_board_member(id, array['admin', 'editor']));

create policy "users can see their own membership request"
on public.board_members
for select
to authenticated
using (
  lower(email) = public.current_user_email()
  or public.is_board_admin(board_id)
);

create policy "users can request access for their own email"
on public.board_members
for insert
to authenticated
with check (
  lower(email) = public.current_user_email()
  and status = 'pending'
  and role in ('viewer', 'editor')
);

create policy "admins can approve and manage members"
on public.board_members
for update
to authenticated
using (public.is_board_admin(board_id))
with check (public.is_board_admin(board_id));

create policy "admins can remove members"
on public.board_members
for delete
to authenticated
using (public.is_board_admin(board_id));

insert into public.board_members (board_id, email, role, status, approved_at)
select 'gtpl-main', 'chaldwinben@gmail.com', 'admin', 'approved', now()
where not exists (
  select 1
  from public.board_members
  where board_id = 'gtpl-main'
    and lower(email) = 'chaldwinben@gmail.com'
);

update public.board_members
set role = 'admin',
    status = 'approved',
    approved_at = coalesce(approved_at, now())
where board_id = 'gtpl-main'
  and lower(email) = 'chaldwinben@gmail.com';
