import fs from 'fs';
import path from 'path';

const g = globalThis;
const accountsFile = path.join(
  process.cwd(),
  process.env.SOCIAL_ACCOUNTS_FILE || '.data/social-accounts.json'
);

function readAccounts() {
  try {
    if (!fs.existsSync(accountsFile)) return [];

    const parsed = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));

    if (Array.isArray(parsed)) return parsed;

    // Compatibilidade com formato antigo:
    // { facebook: {...}, linkedin: {...} }
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).map(([platform, account]) => ({
        id: account.id || crypto.randomUUID(),
        platform,
        ...account,
      }));
    }

    return [];
  } catch (err) {
    console.error('[social] Falha ao carregar contas:', err.message);
    return [];
  }
}

function writeAccounts(accounts) {
  try {
    fs.mkdirSync(path.dirname(accountsFile), { recursive: true });
    fs.writeFileSync(accountsFile, JSON.stringify(accounts, null, 2));
  } catch (err) {
    console.error('[social] Falha ao guardar contas:', err.message);
  }
}

if (!g._socialAccounts) g._socialAccounts = readAccounts();
if (!g._oauthStates) g._oauthStates = new Map();

export function getAccounts() {
  return [...g._socialAccounts];
}

export function getAccountsByPlatform(platform) {
  return g._socialAccounts.filter(
    account => account.platform === platform
  );
}

export function getAccountById(id) {
  return g._socialAccounts.find(
    account => account.id === id
  ) || null;
}

// Mantém compatibilidade com código antigo
export function getAccount(platform) {
  return g._socialAccounts.find(
    account => account.platform === platform
  ) || null;
}

export function addAccount(data) {
  const account = {
    id: data.id || crypto.randomUUID(),
    ...data,
    connectedAt: data.connectedAt || new Date().toISOString(),
  };

  g._socialAccounts.push(account);
  writeAccounts(g._socialAccounts);

  return account;
}

// Mantém compatibilidade com código antigo
export function setAccount(platform, data) {
  return addAccount({
    platform,
    ...data,
  });
}

export function removeAccount(id) {
  g._socialAccounts = g._socialAccounts.filter(
    account => account.id !== id
  );

  writeAccounts(g._socialAccounts);
}

export function removeAccountsByPlatform(platform) {
  g._socialAccounts = g._socialAccounts.filter(
    account => account.platform !== platform
  );

  writeAccounts(g._socialAccounts);
}

export function createState(platform) {
  const rand = Math.random().toString(36).slice(2) + Date.now().toString(36);
  g._oauthStates.set(rand, { platform, ts: Date.now() });
  for (const [k, v] of g._oauthStates) {
    if (Date.now() - v.ts > 15 * 60 * 1000) g._oauthStates.delete(k);
  }
  return rand;
}

export function consumeState(state) {
  const data = g._oauthStates.get(state);
  if (!data) return null;
  if (Date.now() - data.ts > 15 * 60 * 1000) { g._oauthStates.delete(state); return null; }
  g._oauthStates.delete(state);
  return data;
}
