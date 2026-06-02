-- Referência das colunas esperadas na tabela public.news.
-- Usa este bloco apenas se precisares criar a tabela do zero.
-- Se a tua tabela news já existe, confirma se estas colunas existem.

create table if not exists public.news (
  id text primary key,
  title text not null,
  source text,
  image text,
  post text,
  url text,
  sector text,
  score integer,
  status text not null default 'draft',
  processed_by text,
  reject_reason text,
  date timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.news add column if not exists processed_by text;
alter table public.news add column if not exists reject_reason text;

create unique index if not exists news_url_unique_idx
  on public.news (url)
  where url is not null;
