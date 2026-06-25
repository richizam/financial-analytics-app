-- AI conversation metadata for the LangGraph orchestrator.
--
-- NOTE: the LangGraph checkpoint tables (checkpoints, checkpoint_writes,
-- checkpoint_blobs) are created at runtime by PostgresSaver.setup(); they are
-- intentionally NOT declared here. This table only holds per-thread metadata so
-- a future "conversation history" UI can list threads per workspace without
-- reading the checkpoint internals.

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
