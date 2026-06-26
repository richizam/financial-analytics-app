-- Cleanup for an early LangGraph startup that created package-owned checkpoint
-- tables in public before the backend forced LANGGRAPH_CHECKPOINT_SCHEMA.
-- Runtime checkpoint tables now live in app_private.

drop table if exists public.checkpoint_writes;
drop table if exists public.checkpoint_blobs;
drop table if exists public.checkpoints;
drop table if exists public.checkpoint_migrations;
