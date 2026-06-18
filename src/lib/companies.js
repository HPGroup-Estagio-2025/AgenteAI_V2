import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const USE_SUPABASE = SUPABASE_URL.length > 0 && !SUPABASE_URL.includes('xxxx');
const COMPANIES_TABLE = process.env.COMPANIES_TABLE || 'companies';

// Usa service_role key para escrita server-side (bypassa RLS)
// Cai back para anon key se não estiver configurada
const supabaseAdmin = USE_SUPABASE
  ? createClient(
      SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
  : null;

// ─── CRUD Operations ────────────────────────────────────────────────────────

/**
 * Create a new company
 * @param {string} name - Company name (must be unique)
 * @param {string} createdBy - Username who created it
 * @returns {Promise<{id, name, created_at, created_by}>}
 * @throws {Error} with code='invalid_name' if name is empty, or code='duplicate' if name exists
 */
export async function createCompany(name, createdBy, logoUrl = null) {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    const err = new Error('Nome da empresa é obrigatório');
    err.code = 'invalid_name';
    throw err;
  }

  const trimmedName = name.trim();

  if (!USE_SUPABASE) {
    const err = new Error('Supabase não configurado');
    err.code = 'supabase_not_configured';
    throw err;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from(COMPANIES_TABLE)
      .insert([
        {
          id: crypto.randomUUID(),
          name: trimmedName,
          created_by: createdBy || null,
          created_at: new Date().toISOString(),
          active: true,
          logo_url: logoUrl || null,
          website_url: null,
          wordpress_url: null,
          wordpress_username: null,
          wordpress_app_password: null,
        }
      ])
      .select();

    if (error) {
      if (error.code === '23505') {
        // UNIQUE constraint violation
        const err = new Error(`Empresa '${trimmedName}' já existe`);
        err.code = 'duplicate';
        throw err;
      }
      console.error('[companies] Erro ao criar empresa:', error.message);
      throw error;
    }

    return data[0];
  } catch (err) {
    if (err.code === 'duplicate') throw err;
    console.error('[companies] Erro inesperado ao criar empresa:', err.message);
    throw err;
  }
}

/**
 * List all active companies
 * @returns {Promise<Array>} companies with account counts
 */
export async function listCompanies() {
  if (!USE_SUPABASE) {
    return [];
  }

  try {
    const { data, error } = await supabaseAdmin
      .from(COMPANIES_TABLE)
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: true });

    if (error) {
      const isMissingTable = error.code === 'PGRST205' || error.message?.includes('Could not find the table');
      if (isMissingTable) {
        console.warn('[companies] Tabela companies não existe no Supabase');
        return [];
      }
      console.error('[companies] Erro ao listar empresas:', error.message);
      return [];
    }

    // Conta contas por empresa
    const companiesWithCounts = await Promise.all(
      (data || []).map(async (company) => {
        const { count, error: countError } = await supabaseAdmin
          .from('social_accounts')
          .select('*', { count: 'exact' })
          .eq('company_id', company.id)
          .eq('active', true);

        return {
          ...company,
          accountCount: countError ? 0 : (count || 0),
        };
      })
    );

    return companiesWithCounts;
  } catch (err) {
    console.error('[companies] Erro inesperado ao listar empresas:', err.message);
    return [];
  }
}

/**
 * Get single company with its accounts
 * @param {string} companyId - UUID of company
 * @returns {Promise<{id, name, created_at, created_by, accounts: []}>}
 * @throws {Error} with code='not_found' if company doesn't exist
 */
export async function getCompany(companyId) {
  if (!USE_SUPABASE) {
    const err = new Error('Supabase não configurado');
    err.code = 'supabase_not_configured';
    throw err;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from(COMPANIES_TABLE)
      .select('*')
      .eq('id', companyId)
      .single();

    if (error || !data) {
      const err = new Error('Empresa não encontrada');
      err.code = 'not_found';
      throw err;
    }

    // Fetch accounts for this company
    const { data: accounts, error: accountsError } = await supabaseAdmin
      .from('social_accounts')
      .select('*')
      .eq('company_id', companyId);

    return {
      ...data,
      accounts: accountsError ? [] : (accounts || []),
    };
  } catch (err) {
    if (err.code === 'not_found') throw err;
    console.error('[companies] Erro ao buscar empresa:', err.message);
    throw err;
  }
}

/**
 * Soft-delete a company (sets active=false and orphans its accounts)
 * @param {string} companyId - UUID of company
 * @returns {Promise<{success: true}>}
 * @throws {Error} with code='not_found' or code='already_deleted'
 */
export async function deleteCompany(companyId) {
  if (!USE_SUPABASE) {
    const err = new Error('Supabase não configurado');
    err.code = 'supabase_not_configured';
    throw err;
  }

  try {
    // Check if company exists and is active
    const { data: existing, error: checkError } = await supabaseAdmin
      .from(COMPANIES_TABLE)
      .select('*')
      .eq('id', companyId)
      .single();

    if (checkError || !existing) {
      const err = new Error('Empresa não encontrada');
      err.code = 'not_found';
      throw err;
    }

    // Desliga as contas associadas antes de apagar a empresa
    const { error: orphanError } = await supabaseAdmin
      .from('social_accounts')
      .update({ company_id: null })
      .eq('company_id', companyId);

    if (orphanError) {
      console.error('[companies] Erro ao desligar contas:', orphanError.message);
    }

    // Hard delete: apaga o registo da tabela
    const { error: deleteError } = await supabaseAdmin
      .from(COMPANIES_TABLE)
      .delete()
      .eq('id', companyId);

    if (deleteError) {
      console.error('[companies] Erro ao apagar empresa:', deleteError.message);
      throw deleteError;
    }

    return { success: true };
  } catch (err) {
    if (err.code === 'not_found' || err.code === 'already_deleted') throw err;
    console.error('[companies] Erro inesperado ao apagar empresa:', err.message);
    throw err;
  }
}

/**
 * Update company name
 * @param {string} companyId - UUID of company
 * @param {string} newName - New company name (must be unique)
 * @returns {Promise<{id, name, ...}>}
 * @throws {Error} with code='not_found', 'duplicate', or 'invalid_name'
 */
export async function updateCompanyName(companyId, newName) {
  if (!newName || typeof newName !== 'string' || newName.trim().length === 0) {
    const err = new Error('Novo nome é obrigatório');
    err.code = 'invalid_name';
    throw err;
  }

  if (!USE_SUPABASE) {
    const err = new Error('Supabase não configurado');
    err.code = 'supabase_not_configured';
    throw err;
  }

  try {
    const trimmedName = newName.trim();

    // Check if company exists
    const { data: existing, error: checkError } = await supabaseAdmin
      .from(COMPANIES_TABLE)
      .select('*')
      .eq('id', companyId)
      .single();

    if (checkError || !existing) {
      const err = new Error('Empresa não encontrada');
      err.code = 'not_found';
      throw err;
    }

    // Try to update
    const { data, error } = await supabaseAdmin
      .from(COMPANIES_TABLE)
      .update({ name: trimmedName })
      .eq('id', companyId)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        const err = new Error(`Nome '${trimmedName}' já existe`);
        err.code = 'duplicate';
        throw err;
      }
      throw error;
    }

    return data;
  } catch (err) {
    if (err.code === 'not_found' || err.code === 'duplicate' || err.code === 'invalid_name') throw err;
    console.error('[companies] Erro ao atualizar empresa:', err.message);
    throw err;
  }
}

/**
 * Update company settings (website_url, wordpress credentials)
 */
export async function updateCompanySettings(companyId, settings) {
  if (!USE_SUPABASE) {
    const err = new Error('Supabase não configurado');
    err.code = 'supabase_not_configured';
    throw err;
  }

  const allowed = ['logo_url', 'website_url', 'wordpress_url', 'wordpress_username', 'wordpress_app_password', 'linkedin_org_id', 'sectors'];
  const updates = {};
  for (const key of allowed) {
    if (!(key in settings)) continue;
    if (key === 'sectors') {
      updates[key] = Array.isArray(settings[key]) ? JSON.stringify(settings[key]) : null;
    } else {
      updates[key] = settings[key] || null;
    }
  }

  if (Object.keys(updates).length === 0) {
    const err = new Error('Nenhum campo válido para atualizar');
    err.code = 'invalid_fields';
    throw err;
  }

  const { data, error } = await supabaseAdmin
    .from(COMPANIES_TABLE)
    .update(updates)
    .eq('id', companyId)
    .select()
    .single();

  if (error) {
    console.error('[companies] Erro ao atualizar configurações:', error.message, 'code:', error.code);
    // Coluna pode não existir — tenta sem as colunas problemáticas
    if (error.code === '42703' || error.message?.includes('column')) {
      const retryUpdates = { ...updates };
      // Remove colunas que podem não existir e tenta de novo
      for (const col of ['logo_url', 'linkedin_org_id']) {
        if (col in retryUpdates) delete retryUpdates[col];
      }
      if (Object.keys(retryUpdates).length === 0) return { id: companyId };
      const { data: retry, error: retryErr } = await supabaseAdmin
        .from(COMPANIES_TABLE).update(retryUpdates).eq('id', companyId).select().single();
      if (retryErr) throw retryErr;
      // Tenta criar coluna linkedin_org_id via SQL se estava em updates
      if ('linkedin_org_id' in updates) {
        await supabaseAdmin.rpc('exec_sql', {
          sql: `ALTER TABLE ${COMPANIES_TABLE} ADD COLUMN IF NOT EXISTS linkedin_org_id text`
        }).catch(() => {});
        // Re-tenta guardar só o linkedin_org_id
        await supabaseAdmin.from(COMPANIES_TABLE)
          .update({ linkedin_org_id: updates.linkedin_org_id })
          .eq('id', companyId)
          .catch(() => {});
      }
      return retry;
    }
    throw error;
  }

  return data;
}

/**
 * Helper: Ensure company exists (create if not, return ID either way)
 * @param {string} companyName - Company name
 * @param {string} createdBy - Username creating it (if new)
 * @returns {Promise<string>} Company ID
 */
export async function ensureCompanyExists(companyName, createdBy) {
  if (!companyName || typeof companyName !== 'string') {
    return null;
  }

  if (!USE_SUPABASE) {
    return null;
  }

  try {
    const trimmedName = companyName.trim();

    // Check if it already exists
    const { data: existing } = await supabaseAdmin
      .from(COMPANIES_TABLE)
      .select('id')
      .eq('name', trimmedName)
      .eq('active', true)
      .single();

    if (existing) {
      return existing.id;
    }

    // Create new company
    const created = await createCompany(trimmedName, createdBy);
    return created.id;
  } catch (err) {
    if (err.code === 'duplicate') {
      // Race condition: someone created it between our check and insert
      // Fetch it and return its ID
      try {
        const { data } = await supabaseAdmin
          .from(COMPANIES_TABLE)
          .select('id')
          .eq('name', companyName.trim())
          .eq('active', true)
          .single();
        return data?.id || null;
      } catch {
        return null;
      }
    }
    console.error('[companies] Erro ao garantir existência da empresa:', err.message);
    return null;
  }
}

/**
 * Migration helper: Migrate companyName to company_id in social_accounts
 * Runs once on app startup to convert old data
 */
export async function migrateCompanyNamesToIds() {
  if (!USE_SUPABASE) {
    console.log('[companies] Migration skipped: Supabase not configured');
    return;
  }

  try {
    // Check if migration already ran (check if any accounts still have company_name without company_id)
    const { data: unmigrated } = await supabaseAdmin
      .from('social_accounts')
      .select('company_name')
      .not('company_name', 'is', null)
      .limit(1);

    if (!unmigrated || unmigrated.length === 0) {
      console.log('[companies] Migration: No company_name data found, skipping');
      return;
    }

    console.log('[companies] Starting migration from company_name to company_id...');

    // Get all unique company names
    const { data: allAccounts } = await supabaseAdmin
      .from('social_accounts')
      .select('id, company_name, company_id')
      .not('company_name', 'is', null);

    if (!allAccounts || allAccounts.length === 0) {
      console.log('[companies] No accounts to migrate');
      return;
    }

    const uniqueNames = [...new Set(allAccounts.map(a => a.company_name).filter(Boolean))];
    let migratedCount = 0;

    // For each unique company name, ensure it exists and update accounts
    for (const companyName of uniqueNames) {
      try {
        const companyId = await ensureCompanyExists(companyName, 'migration');

        if (companyId) {
          // Update all accounts with this company_name to use company_id
          const accountsToMigrate = allAccounts.filter(a => a.company_name === companyName && !a.company_id);

          for (const account of accountsToMigrate) {
            const { error } = await supabaseAdmin
              .from('social_accounts')
              .update({ company_id: companyId, company_name: null })
              .eq('id', account.id);

            if (!error) {
              migratedCount++;
            } else {
              console.error(`[companies] Erro ao migrar conta ${account.id}:`, error.message);
            }
          }
        }
      } catch (err) {
        console.error(`[companies] Erro ao processar empresa '${companyName}':`, err.message);
      }
    }

    console.log(`[companies] Migration complete: ${migratedCount} accounts migrated`);
  } catch (err) {
    console.error('[companies] Migration error:', err.message);
  }
}
