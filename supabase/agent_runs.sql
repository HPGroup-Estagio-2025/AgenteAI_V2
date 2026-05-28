-- Executar no Supabase SQL Editor.
-- Esta tabela guarda o histórico de execuções do agente interno de notícias.

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null default 'news-agent',
  trigger_type text not null default 'manual',
  triggered_by text,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  inserted_count integer not null default 0,
  summary jsonb,
  error text,
  started_at timestamp with time zone not null default now(),
  finished_at timestamp with time zone
);

create index if not exists agent_runs_started_at_idx
  on public.agent_runs (started_at desc);

-- Opcional, mas recomendado para evitar notícias duplicadas por URL.
-- Só cria o índice se ainda não existir outro equivalente.
create unique index if not exists news_url_unique_idx
  on public.news (url)
  where url is not null;


-- Nota: a coluna public.news.id deve ser uuid ou aceitar UUIDs gerados pelo agente.
