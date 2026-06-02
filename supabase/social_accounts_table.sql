-- Run this in Supabase SQL Editor to create or update the social_accounts table.

create table if not exists public.social_accounts (
  id uuid primary key,
  platform text not null,
  name text,
  email text,
  picture text,
  access_token text,
  pages jsonb default '[]'::jsonb,
  instagram_user_id text,
  company_id uuid references public.companies(id) on delete set null,
  company_name text,
  expires_at timestamptz,
  connected_at timestamptz not null default now(),
  active boolean not null default true
);

alter table public.social_accounts add column if not exists platform text;
alter table public.social_accounts add column if not exists name text;
alter table public.social_accounts add column if not exists email text;
alter table public.social_accounts add column if not exists picture text;
alter table public.social_accounts add column if not exists access_token text;
alter table public.social_accounts add column if not exists pages jsonb default '[]'::jsonb;
alter table public.social_accounts add column if not exists instagram_user_id text;
alter table public.social_accounts add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.social_accounts add column if not exists company_name text;
alter table public.social_accounts add column if not exists expires_at timestamptz;
alter table public.social_accounts add column if not exists connected_at timestamptz not null default now();
alter table public.social_accounts add column if not exists active boolean not null default true;

create index if not exists social_accounts_platform_idx
  on public.social_accounts(platform);

create index if not exists social_accounts_company_id_idx
  on public.social_accounts(company_id);

