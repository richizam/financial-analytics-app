create table if not exists public.csv_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  source_file_id uuid references public.csv_files(id) on delete set null,
  ruc text not null,
  filename text not null,
  period text,
  import_type text not null,
  status text not null default 'succeeded',
  provider text not null default 'canonical',
  mapping jsonb not null default '{}'::jsonb,
  confidence numeric(5,4) not null default 1,
  row_count integer not null default 0,
  error_count integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint csv_imports_ruc_check check (ruc ~ '^[0-9]{13}$'),
  constraint csv_imports_period_check check (period is null or period ~ '^[0-9]{6}$'),
  constraint csv_imports_import_type_check check (import_type in ('journal', 'opening_balance')),
  constraint csv_imports_status_check check (status in ('succeeded', 'failed', 'mapping_required')),
  constraint csv_imports_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint csv_imports_workspace_ruc_filename_key unique (workspace_id, ruc, filename)
);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  source_file_id uuid references public.csv_files(id) on delete set null,
  import_id uuid references public.csv_imports(id) on delete set null,
  ruc text not null,
  period text not null,
  row_number integer not null,
  fecha date not null,
  asiento text not null,
  tipo text not null default '',
  cod_cuenta text not null,
  nombre_cuenta text not null,
  descripcion text not null,
  debe_cents bigint not null default 0,
  haber_cents bigint not null default 0,
  centro_costo text not null default '',
  document_number text,
  currency text,
  raw_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint journal_entries_ruc_check check (ruc ~ '^[0-9]{13}$'),
  constraint journal_entries_period_check check (period ~ '^[0-9]{6}$'),
  constraint journal_entries_row_number_check check (row_number > 0),
  constraint journal_entries_amounts_check check (debe_cents >= 0 and haber_cents >= 0)
);

create table if not exists public.opening_balances (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  source_file_id uuid references public.csv_files(id) on delete set null,
  import_id uuid references public.csv_imports(id) on delete set null,
  ruc text not null,
  year integer not null,
  cod_cuenta text not null,
  nombre_cuenta text not null,
  saldo_cents bigint not null,
  tipo text not null default '',
  raw_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, ruc, year, cod_cuenta),
  constraint opening_balances_ruc_check check (ruc ~ '^[0-9]{13}$'),
  constraint opening_balances_year_check check (year between 1900 and 2200)
);

create table if not exists public.account_period_balances (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  ruc text not null,
  period text not null,
  cod_cuenta text not null,
  nombre_cuenta text not null,
  total_debe_cents bigint not null default 0,
  total_haber_cents bigint not null default 0,
  saldo_cents bigint not null default 0,
  entry_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, ruc, period, cod_cuenta),
  constraint account_period_balances_ruc_check check (ruc ~ '^[0-9]{13}$'),
  constraint account_period_balances_period_check check (period ~ '^[0-9]{6}$')
);

create table if not exists public.analysis_cache (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  ruc text not null,
  analysis_type text not null,
  period_key text not null,
  cache_version integer not null default 1,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, ruc, analysis_type, period_key, cache_version),
  constraint analysis_cache_ruc_check check (ruc ~ '^[0-9]{13}$'),
  constraint analysis_cache_version_check check (cache_version > 0)
);

create index if not exists csv_imports_workspace_ruc_idx on public.csv_imports(workspace_id, ruc);
create index if not exists csv_imports_company_id_idx on public.csv_imports(company_id);
create index if not exists csv_imports_source_file_id_idx on public.csv_imports(source_file_id);
create index if not exists journal_entries_workspace_ruc_period_idx on public.journal_entries(workspace_id, ruc, period);
create index if not exists journal_entries_company_period_idx on public.journal_entries(company_id, period);
create index if not exists journal_entries_account_idx on public.journal_entries(workspace_id, ruc, cod_cuenta, period);
create index if not exists journal_entries_source_file_id_idx on public.journal_entries(source_file_id);
create index if not exists journal_entries_import_id_idx on public.journal_entries(import_id);
create index if not exists opening_balances_company_year_idx on public.opening_balances(company_id, year);
create index if not exists opening_balances_source_file_id_idx on public.opening_balances(source_file_id);
create index if not exists opening_balances_import_id_idx on public.opening_balances(import_id);
create index if not exists account_period_balances_company_period_idx on public.account_period_balances(company_id, period);
create index if not exists analysis_cache_company_idx on public.analysis_cache(company_id);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'csv_imports_set_updated_at'
  ) then
    create trigger csv_imports_set_updated_at
      before update on public.csv_imports
      for each row execute function app_private.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'opening_balances_set_updated_at'
  ) then
    create trigger opening_balances_set_updated_at
      before update on public.opening_balances
      for each row execute function app_private.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'account_period_balances_set_updated_at'
  ) then
    create trigger account_period_balances_set_updated_at
      before update on public.account_period_balances
      for each row execute function app_private.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'analysis_cache_set_updated_at'
  ) then
    create trigger analysis_cache_set_updated_at
      before update on public.analysis_cache
      for each row execute function app_private.set_updated_at();
  end if;
end $$;

alter table public.csv_imports enable row level security;
alter table public.journal_entries enable row level security;
alter table public.opening_balances enable row level security;
alter table public.account_period_balances enable row level security;
alter table public.analysis_cache enable row level security;

grant select, insert, update, delete on public.csv_imports to authenticated;
grant select, insert, update, delete on public.journal_entries to authenticated;
grant select, insert, update, delete on public.opening_balances to authenticated;
grant select, insert, update, delete on public.account_period_balances to authenticated;
grant select, insert, update, delete on public.analysis_cache to authenticated;

drop policy if exists "csv_imports_select_member" on public.csv_imports;
create policy "csv_imports_select_member"
  on public.csv_imports
  for select
  to authenticated
  using ((select app_private.is_workspace_member(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "csv_imports_insert_member" on public.csv_imports;
create policy "csv_imports_insert_member"
  on public.csv_imports
  for insert
  to authenticated
  with check ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "csv_imports_update_member" on public.csv_imports;
create policy "csv_imports_update_member"
  on public.csv_imports
  for update
  to authenticated
  using ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()))
  with check ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "csv_imports_delete_member" on public.csv_imports;
create policy "csv_imports_delete_member"
  on public.csv_imports
  for delete
  to authenticated
  using ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "journal_entries_select_member" on public.journal_entries;
create policy "journal_entries_select_member"
  on public.journal_entries
  for select
  to authenticated
  using ((select app_private.is_workspace_member(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "journal_entries_insert_member" on public.journal_entries;
create policy "journal_entries_insert_member"
  on public.journal_entries
  for insert
  to authenticated
  with check ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "journal_entries_update_member" on public.journal_entries;
create policy "journal_entries_update_member"
  on public.journal_entries
  for update
  to authenticated
  using ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()))
  with check ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "journal_entries_delete_member" on public.journal_entries;
create policy "journal_entries_delete_member"
  on public.journal_entries
  for delete
  to authenticated
  using ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "opening_balances_select_member" on public.opening_balances;
create policy "opening_balances_select_member"
  on public.opening_balances
  for select
  to authenticated
  using ((select app_private.is_workspace_member(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "opening_balances_insert_member" on public.opening_balances;
create policy "opening_balances_insert_member"
  on public.opening_balances
  for insert
  to authenticated
  with check ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "opening_balances_update_member" on public.opening_balances;
create policy "opening_balances_update_member"
  on public.opening_balances
  for update
  to authenticated
  using ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()))
  with check ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "opening_balances_delete_member" on public.opening_balances;
create policy "opening_balances_delete_member"
  on public.opening_balances
  for delete
  to authenticated
  using ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "account_period_balances_select_member" on public.account_period_balances;
create policy "account_period_balances_select_member"
  on public.account_period_balances
  for select
  to authenticated
  using ((select app_private.is_workspace_member(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "account_period_balances_insert_member" on public.account_period_balances;
create policy "account_period_balances_insert_member"
  on public.account_period_balances
  for insert
  to authenticated
  with check ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "account_period_balances_update_member" on public.account_period_balances;
create policy "account_period_balances_update_member"
  on public.account_period_balances
  for update
  to authenticated
  using ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()))
  with check ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "account_period_balances_delete_member" on public.account_period_balances;
create policy "account_period_balances_delete_member"
  on public.account_period_balances
  for delete
  to authenticated
  using ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "analysis_cache_select_member" on public.analysis_cache;
create policy "analysis_cache_select_member"
  on public.analysis_cache
  for select
  to authenticated
  using ((select app_private.is_workspace_member(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "analysis_cache_insert_member" on public.analysis_cache;
create policy "analysis_cache_insert_member"
  on public.analysis_cache
  for insert
  to authenticated
  with check ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "analysis_cache_update_member" on public.analysis_cache;
create policy "analysis_cache_update_member"
  on public.analysis_cache
  for update
  to authenticated
  using ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()))
  with check ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "analysis_cache_delete_member" on public.analysis_cache;
create policy "analysis_cache_delete_member"
  on public.analysis_cache
  for delete
  to authenticated
  using ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));
