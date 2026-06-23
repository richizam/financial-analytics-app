create extension if not exists pgcrypto;

create schema if not exists app_private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'accountant',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_check check (role in ('accountant', 'platform_admin'))
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'trialing',
  created_by uuid references auth.users(id) on delete set null,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_status_check check (status in ('trialing', 'active', 'suspended'))
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint workspace_members_role_check check (role in ('owner', 'admin', 'member', 'viewer'))
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ruc text not null,
  razon_social text,
  sector text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_ruc_check check (ruc ~ '^[0-9]{13}$'),
  constraint companies_workspace_ruc_key unique (workspace_id, ruc)
);

create table if not exists public.csv_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  ruc text not null,
  filename text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint csv_files_ruc_check check (ruc ~ '^[0-9]{13}$'),
  constraint csv_files_filename_check check (filename ~* '^([0-9]{6}|saldos_iniciales_[0-9]{4})\.csv$'),
  constraint csv_files_workspace_ruc_filename_key unique (workspace_id, ruc, filename)
);

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists workspaces_status_idx on public.workspaces(status);
create index if not exists workspaces_created_by_idx on public.workspaces(created_by);
create index if not exists workspace_members_user_id_idx on public.workspace_members(user_id);
create index if not exists workspace_members_workspace_role_idx on public.workspace_members(workspace_id, role);
create index if not exists companies_workspace_id_idx on public.companies(workspace_id);
create index if not exists companies_ruc_idx on public.companies(ruc);
create index if not exists csv_files_workspace_ruc_idx on public.csv_files(workspace_id, ruc);
create index if not exists csv_files_company_id_idx on public.csv_files(company_id);

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app_private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'platform_admin'
  );
$$;

create or replace function app_private.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.workspace_id = target_workspace_id
      and wm.user_id = (select auth.uid())
      and w.status in ('trialing', 'active')
  );
$$;

create or replace function app_private.can_write_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.workspace_id = target_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner', 'admin', 'member')
      and w.status in ('trialing', 'active')
  );
$$;

create or replace function app_private.can_manage_workspace_members(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.workspace_id = target_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner', 'admin')
      and w.status in ('trialing', 'active')
  );
$$;

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workspace_id uuid;
  display_name text;
begin
  display_name := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), '');

  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), display_name)
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        updated_at = now();

  insert into public.workspaces (name, status, created_by)
  values (
    coalesce(display_name, split_part(coalesce(new.email, 'Contador'), '@', 1), 'Contador') || ' Workspace',
    'trialing',
    new.id
  )
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'profiles_set_updated_at'
  ) then
    create trigger profiles_set_updated_at
      before update on public.profiles
      for each row execute function app_private.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'workspaces_set_updated_at'
  ) then
    create trigger workspaces_set_updated_at
      before update on public.workspaces
      for each row execute function app_private.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'companies_set_updated_at'
  ) then
    create trigger companies_set_updated_at
      before update on public.companies
      for each row execute function app_private.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'csv_files_set_updated_at'
  ) then
    create trigger csv_files_set_updated_at
      before update on public.csv_files
      for each row execute function app_private.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'on_auth_user_created'
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function app_private.handle_new_user();
  end if;
end $$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.companies enable row level security;
alter table public.csv_files enable row level security;

grant select, update on public.profiles to authenticated;
grant select, update on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.companies to authenticated;
grant select, insert, update, delete on public.csv_files to authenticated;
grant usage on schema app_private to authenticated;
grant execute on all functions in schema app_private to authenticated;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()) or (select app_private.is_platform_admin()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and role = 'accountant');

drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member"
  on public.workspaces
  for select
  to authenticated
  using ((select app_private.is_workspace_member(id)) or (select app_private.is_platform_admin()));

drop policy if exists "workspaces_update_writers" on public.workspaces;
create policy "workspaces_update_writers"
  on public.workspaces
  for update
  to authenticated
  using ((select app_private.can_write_workspace(id)) or (select app_private.is_platform_admin()))
  with check ((select app_private.can_write_workspace(id)) or (select app_private.is_platform_admin()));

drop policy if exists "workspace_members_select_member" on public.workspace_members;
create policy "workspace_members_select_member"
  on public.workspace_members
  for select
  to authenticated
  using ((select app_private.is_workspace_member(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "workspace_members_manage_admins" on public.workspace_members;
drop policy if exists "workspace_members_insert_admins" on public.workspace_members;
create policy "workspace_members_insert_admins"
  on public.workspace_members
  for insert
  to authenticated
  with check ((select app_private.can_manage_workspace_members(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "workspace_members_update_admins" on public.workspace_members;
create policy "workspace_members_update_admins"
  on public.workspace_members
  for update
  to authenticated
  using ((select app_private.can_manage_workspace_members(workspace_id)) or (select app_private.is_platform_admin()))
  with check ((select app_private.can_manage_workspace_members(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "workspace_members_delete_admins" on public.workspace_members;
create policy "workspace_members_delete_admins"
  on public.workspace_members
  for delete
  to authenticated
  using ((select app_private.can_manage_workspace_members(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "companies_select_member" on public.companies;
create policy "companies_select_member"
  on public.companies
  for select
  to authenticated
  using ((select app_private.is_workspace_member(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "companies_write_member" on public.companies;
drop policy if exists "companies_insert_member" on public.companies;
create policy "companies_insert_member"
  on public.companies
  for insert
  to authenticated
  with check ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "companies_update_member" on public.companies;
create policy "companies_update_member"
  on public.companies
  for update
  to authenticated
  using ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()))
  with check ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "companies_delete_member" on public.companies;
create policy "companies_delete_member"
  on public.companies
  for delete
  to authenticated
  using ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "csv_files_select_member" on public.csv_files;
create policy "csv_files_select_member"
  on public.csv_files
  for select
  to authenticated
  using ((select app_private.is_workspace_member(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "csv_files_write_member" on public.csv_files;
drop policy if exists "csv_files_insert_member" on public.csv_files;
create policy "csv_files_insert_member"
  on public.csv_files
  for insert
  to authenticated
  with check ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "csv_files_update_member" on public.csv_files;
create policy "csv_files_update_member"
  on public.csv_files
  for update
  to authenticated
  using ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()))
  with check ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "csv_files_delete_member" on public.csv_files;
create policy "csv_files_delete_member"
  on public.csv_files
  for delete
  to authenticated
  using ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));
