-- AI conversation metadata for the LangGraph orchestrator.
--
-- NOTE: the LangGraph checkpoint tables are created at runtime by
-- PostgresSaver.setup() in app_private (see LANGGRAPH_CHECKPOINT_SCHEMA), not in
-- public. This table only holds per-thread metadata so a future "conversation
-- history" UI can list threads per workspace without reading checkpoint internals.

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id text not null,
  thread_id text not null,
  title text,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_conversations_workspace_conversation_key unique (workspace_id, conversation_id)
);

create index if not exists ai_conversations_workspace_recent_idx
  on public.ai_conversations (workspace_id, last_message_at desc);

drop trigger if exists set_ai_conversations_updated_at on public.ai_conversations;
create trigger set_ai_conversations_updated_at
  before update on public.ai_conversations
  for each row execute function app_private.set_updated_at();

alter table public.ai_conversations enable row level security;

grant select, insert, update, delete on public.ai_conversations to authenticated;

drop policy if exists "ai_conversations_select_member" on public.ai_conversations;
create policy "ai_conversations_select_member"
  on public.ai_conversations
  for select
  to authenticated
  using ((select app_private.is_workspace_member(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "ai_conversations_insert_member" on public.ai_conversations;
create policy "ai_conversations_insert_member"
  on public.ai_conversations
  for insert
  to authenticated
  with check ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "ai_conversations_update_member" on public.ai_conversations;
create policy "ai_conversations_update_member"
  on public.ai_conversations
  for update
  to authenticated
  using ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()))
  with check ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));

drop policy if exists "ai_conversations_delete_member" on public.ai_conversations;
create policy "ai_conversations_delete_member"
  on public.ai_conversations
  for delete
  to authenticated
  using ((select app_private.can_write_workspace(workspace_id)) or (select app_private.is_platform_admin()));
