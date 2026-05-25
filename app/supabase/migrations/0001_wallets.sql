-- Run this in Supabase Dashboard → SQL Editor (or via supabase db push)

create extension if not exists pgcrypto;

create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  address text unique not null,
  encrypted_private_key text,
  source text not null default 'internal',
  created_at timestamptz not null default now()
);

create index if not exists wallets_user_id_idx on public.wallets (user_id);

-- Row Level Security: each user can only see / modify their own wallet rows.
alter table public.wallets enable row level security;

drop policy if exists "wallets_select_own" on public.wallets;
create policy "wallets_select_own"
  on public.wallets for select
  using (auth.uid() = user_id);

drop policy if exists "wallets_insert_own" on public.wallets;
create policy "wallets_insert_own"
  on public.wallets for insert
  with check (auth.uid() = user_id);

drop policy if exists "wallets_update_own" on public.wallets;
create policy "wallets_update_own"
  on public.wallets for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "wallets_delete_own" on public.wallets;
create policy "wallets_delete_own"
  on public.wallets for delete
  using (auth.uid() = user_id);
