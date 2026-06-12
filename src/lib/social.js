import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

const STATE_SECRET = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'oauth-state-secret-fallback';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const USE_SUPABASE = SUPABASE_URL.length > 0 && !SUPABASE_URL.includes('xxxx');
export const SOCIAL_TABLE = process.env.SOCIAL_ACCOUNTS_TABLE || 'social_accounts';

// Usa service_role key para escrita server-side (bypassa RLS)
// Cai back para anon key se não estiver configurada
export const supabaseAdmin = USE_SUPABASE
  ? createClient(
      SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
  : null;

const g = globalThis;
const accountsFile = path.join(
  process.cwd(),
  process.env.SOCIAL_ACCOUNTS_FILE || '.data/social-accounts.json'
);

// ─── Armazenamento em ficheiro (fallback quando Supabase não está disponível) ───

function readAccountsFromFile() {
  try {
    if (!fs.existsSync(accountsFile)) return [];
    const parsed = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).map(([platform, account]) => ({
        id: account.id || crypto.randomUUID(),
        platform,
        ...account,
      }));
    }
    return [];
  } catch (err) {
    console.error('[social] Falha ao carregar contas do ficheiro:', err.message);
    return [];
  }
}

function writeAccountsToFile(accounts) {
  try {
    fs.mkdirSync(path.dirname(accountsFile), { recursive: true });
    fs.writeFileSync(accountsFile, JSON.stringify(accounts, null, 2));
  } catch (err) {
    console.error('[social] Falha ao guardar contas no ficheiro:', err.message);
  }
}

// ─── Supabase ───────────────────────────────────────────────────────────────

function toDbRow(account) {
  return {
    id: account.id,
    account_id: account.accountId || account.providerAccountId || account.id,
    platform: account.platform,
    name: account.name || null,
    email: account.email || null,
    picture: account.picture || null,
    access_token: account.accessToken || null,
    pages: account.pages || [],
    instagram_user_id: account.instagramUserId || null,
    company_id: account.companyId || null,
    company_name: account.companyName || null,
    expires_at: account.expiresAt || null,
    connected_at: account.connectedAt || new Date().toISOString(),
    selected_page_id: account.selectedPageId || null,
    active: true,
  };
}

function fromDbRow(row) {
  return {
    id: row.id,
    accountId: row.account_id || null,
    platform: row.platform,
    name: row.name,
    email: row.email || null,
    picture: row.picture || null,
    accessToken: row.access_token,
    pages: Array.isArray(row.pages) ? row.pages : [],
    instagramUserId: row.instagram_user_id || null,
    companyId: row.company_id || null,
    companyName: row.company_name || null,
    expiresAt: row.expires_at || null,
    connectedAt: row.connected_at,
    selectedPageId: row.selected_page_id || null,
  };
}

async function supabaseReadAll() {
  try {
    const client = supabaseAdmin || supabase;
    const { data, error } = await client
      .from(SOCIAL_TABLE)
      .select('*')
      .order('connected_at', { ascending: true });

    if (error) {
      const isMissingTable = error.code === 'PGRST205' || error.message?.includes('Could not find the table');
      if (isMissingTable) {
        console.warn('[social] Tabela social_accounts não existe no Supabase — usa ficheiro local.');
        return [];
      }
      console.error('[social] Erro ao ler do Supabase:', error.message);
      return [];
    }
    return (data || []).map(fromDbRow);
  } catch (err) {
    console.error('[social] Erro inesperado ao ler do Supabase:', err.message);
    return [];
  }
}

async function supabaseUpsert(account) {
  const fullRow = toDbRow(account);

  // Tenta upserts com progressivamente menos colunas até um funcionar.
  // Nível 2 mantém instagram_user_id e pages que são críticos para publicação.
  const rowVariants = [
    fullRow,
    {
      id: fullRow.id,
      account_id: fullRow.account_id,
      platform: fullRow.platform,
      name: fullRow.name || null,
      access_token: fullRow.access_token || null,
      pages: fullRow.pages || [],
      instagram_user_id: fullRow.instagram_user_id || null,
      company_id: fullRow.company_id || null,
      company_name: fullRow.company_name || null,
      connected_at: fullRow.connected_at || new Date().toISOString(),
    },
    {
      id: fullRow.id,
      account_id: fullRow.account_id,
      platform: fullRow.platform,
      name: fullRow.name || null,
      access_token: fullRow.access_token || null,
      pages: fullRow.pages || [],
      instagram_user_id: fullRow.instagram_user_id || null,
      company_id: fullRow.company_id || null,
      connected_at: fullRow.connected_at || new Date().toISOString(),
    },
    {
      id: fullRow.id,
      account_id: fullRow.account_id,
      platform: fullRow.platform,
      name: fullRow.name || null,
      access_token: fullRow.access_token || null,
      pages: fullRow.pages || [],
      instagram_user_id: fullRow.instagram_user_id || null,
      connected_at: fullRow.connected_at || new Date().toISOString(),
    },
    {
      id: fullRow.id,
      account_id: fullRow.account_id,
      platform: fullRow.platform,
      name: fullRow.name || null,
      access_token: fullRow.access_token || null,
      company_name: fullRow.company_name || null,
      connected_at: fullRow.connected_at || new Date().toISOString(),
    },
    {
      id: fullRow.id,
      account_id: fullRow.account_id,
      platform: fullRow.platform,
      name: fullRow.name || null,
      access_token: fullRow.access_token || null,
      connected_at: fullRow.connected_at || new Date().toISOString(),
    },
  ];

  let lastError = null;
  for (const row of rowVariants) {
    const { error } = await supabaseAdmin.from(SOCIAL_TABLE).upsert(row, { onConflict: 'id' });
    if (!error) return;
    if (error.code === '23505') {
      lastError = error;
      break;
    }
    console.warn('[social] upsert falhou, a tentar com menos colunas:', error.message);
    lastError = error;
  }

  console.error('[social] Erro ao guardar conta no Supabase:', lastError.message);
  throw lastError;
}

async function supabaseDelete(id) {
  const { error } = await supabaseAdmin.from(SOCIAL_TABLE).delete().eq('id', id);
  if (error) console.error('[social] Erro ao apagar conta do Supabase:', error.message);
}

async function supabaseDeleteByPlatform(platform) {
  const { error } = await supabaseAdmin.from(SOCIAL_TABLE).delete().eq('platform', platform);
  if (error) console.error('[social] Erro ao apagar contas do Supabase:', error.message);
}

async function findExistingAccountId(platform, accountId, companyId) {
  if (!USE_SUPABASE || !platform || !accountId) return null;
  try {
    // Se há companyId, procura a combinação exacta (platform + accountId + companyId)
    // Isto permite o mesmo utilizador LinkedIn ligar a múltiplas empresas
    if (companyId) {
      const { data: exact } = await supabaseAdmin
        .from(SOCIAL_TABLE)
        .select('id')
        .eq('platform', platform)
        .eq('account_id', accountId)
        .eq('company_id', companyId)
        .limit(1);
      if (exact?.[0]?.id) return exact[0].id;
      // Não existe para esta empresa — vai criar nova entrada
      return null;
    }

    // Sem companyId: comportamento original (upsert sobre a entrada mais recente)
    const { data, error } = await supabaseAdmin
      .from(SOCIAL_TABLE)
      .select('id')
      .eq('platform', platform)
      .eq('account_id', accountId)
      .order('connected_at', { ascending: false })
      .limit(1);

    if (error) {
      console.warn('[social] Falha ao procurar conta existente:', error.message);
      return null;
    }
    return data?.[0]?.id || null;
  } catch (err) {
    console.warn('[social] Erro ao procurar conta existente:', err.message);
    return null;
  }
}

// ─── Inicialização da cache em memória ─────────────────────────────────────
// _socialReady é uma Promise que resolve quando os dados estão carregados.
// As funções de leitura síncronas (getAccount, etc.) usam a cache em memória.
// As funções de escrita (addAccount, removeAccount) são async e persistem imediatamente.

if (!g._socialAccounts) {
  if (USE_SUPABASE) {
    g._socialAccounts = [];
    g._socialReady = supabaseReadAll().then(accounts => {
      if (accounts !== null) {
        g._socialAccounts = accounts;
        // Trigger migration of old company_name data to company_id
        // Import here to avoid circular dependency
        import('./companies.js').then(m => {
          if (m.migrateCompanyNamesToIds) {
            m.migrateCompanyNamesToIds().catch(err => {
              console.error('[social] Migration error:', err.message);
            });
          }
        }).catch(err => {
          console.warn('[social] Could not import companies module for migration:', err.message);
        });
      } else {
        // Supabase não tem a tabela — fallback para ficheiro
        g._socialAccounts = [];
      }
    }).catch(() => {
      g._socialAccounts = [];
    });
  } else {
    g._socialAccounts = readAccountsFromFile();
    g._socialReady = Promise.resolve();
  }
} else if (!g._socialReady) {
  g._socialReady = Promise.resolve();
}

if (!g._oauthStates) g._oauthStates = new Map();

// Aguarda o carregamento inicial dos dados (útil em rotas que precisam de dados frescos)
export function waitForAccounts() {
  return g._socialReady || Promise.resolve();
}

// Força o recarregamento das contas do Supabase (ignora cache em memória)
export async function refreshAccountsFromSupabase() {
  if (USE_SUPABASE) {
    try {
      const freshAccounts = await supabaseReadAll();
      if (freshAccounts !== null) {
        g._socialAccounts = freshAccounts;
        console.log('[social] Cache recarregada do Supabase:', freshAccounts.length, 'contas');
      }
    } catch (err) {
      console.error('[social] Erro ao recarregar do Supabase:', err.message);
    }
  }
}

// ─── API pública (leitura — síncrona, usa cache) ────────────────────────────

export function getAccounts() {
  return [...g._socialAccounts];
}

export function getAccountsByPlatform(platform) {
  return g._socialAccounts.filter(a => a.platform === platform);
}

export function getAccountById(id) {
  return g._socialAccounts.find(a => a.id === id) || null;
}

// Mantém compatibilidade com código antigo
export function getAccount(platform) {
  return g._socialAccounts.find(a => a.platform === platform) || null;
}

// ─── API pública (escrita — async, persiste no Supabase ou ficheiro) ────────

export async function addAccount(data) {
  const accountId = data.accountId || data.providerAccountId || null;

  // Cada empresa tem o seu próprio registo independente.
  // Procura registo existente para ESTA empresa+plataforma para atualizar em vez de duplicar.
  let existingId = null;
  if (USE_SUPABASE && accountId && data.companyId) {
    const { data: existing } = await supabaseAdmin
      .from(SOCIAL_TABLE)
      .select('id')
      .eq('platform', data.platform)
      .eq('account_id', accountId)
      .eq('company_id', data.companyId)
      .limit(1);
    if (existing?.[0]) existingId = existing[0].id;
  }

  const account = {
    id: data.id || existingId || crypto.randomUUID(),
    ...data,
    accountId,
    companyId: data.companyId || null,
    companyName: data.companyName || null,
    connectedAt: data.connectedAt || new Date().toISOString(),
  };

  if (USE_SUPABASE) {
    await supabaseUpsert(account);
    const existingIndex = g._socialAccounts.findIndex(a => a.id === account.id);
    if (existingIndex >= 0) {
      g._socialAccounts[existingIndex] = account;
    } else {
      g._socialAccounts.push(account);
    }
    return account;
  }

  // Atualiza cache em memória imediatamente
  // Persiste — falha de Supabase não bloqueia a ligação OAuth
  if (USE_SUPABASE) {
    try {
      await supabaseUpsert(account);
    } catch (err) {
      console.error('[social] Falha ao persistir conta no Supabase (conta guardada em memória):', err.message);
    }
  } else {
    writeAccountsToFile([...g._socialAccounts, account]);
  }

  g._socialAccounts.push(account);
  return account;
}

// Mantém compatibilidade com código antigo
export function setAccount(platform, data) {
  return addAccount({ platform, ...data });
}

export async function removeAccount(id) {
  g._socialAccounts = g._socialAccounts.filter(a => a.id !== id);
  if (USE_SUPABASE) {
    await supabaseDelete(id);
  } else {
    writeAccountsToFile(g._socialAccounts);
  }
}

// Remove a ligação a uma empresa específica — a conta fica partilhada (visível em todas as empresas)
export async function shareAccount(id) {
  const idx = g._socialAccounts.findIndex(a => a.id === id);
  if (idx >= 0) {
    g._socialAccounts[idx] = { ...g._socialAccounts[idx], companyId: null, companyName: null };
  }
  if (USE_SUPABASE) {
    const { error } = await supabaseAdmin
      .from(SOCIAL_TABLE)
      .update({ company_id: null })
      .eq('id', id);
    if (error) {
      console.error('[social] Erro ao partilhar conta:', error.message);
      throw error; // propaga o erro para a rota poder responder com falha
    }
  }
}

export async function removeAccountsByPlatform(platform) {
  g._socialAccounts = g._socialAccounts.filter(a => a.platform !== platform);
  if (USE_SUPABASE) {
    await supabaseDeleteByPlatform(platform);
  } else {
    writeAccountsToFile(g._socialAccounts);
  }
}

// ─── Estado OAuth (JWT stateless — funciona em qualquer instância Vercel) ───

export function createState(platform, companyId = null) {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return jwt.sign({ platform, nonce, companyId: companyId || null }, STATE_SECRET, { expiresIn: '15m' });
}

export function consumeState(state) {
  try {
    const data = jwt.verify(state, STATE_SECRET);
    return { platform: data.platform, companyId: data.companyId || null };
  } catch {
    return null;
  }
}

