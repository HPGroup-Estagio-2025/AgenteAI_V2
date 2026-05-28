require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const table = process.env.SUPABASE_NEWS_TABLE || 'news';
const apply = process.argv.includes('--apply');
const TITLE_STOP_WORDS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'na', 'nas', 'no', 'nos', 'o', 'os', 'para', 'por', 'que',
  'the', 'a', 'an', 'and', 'for', 'from', 'in', 'of', 'on', 'to', 'with',
]);

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase nao configurada.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return raw.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  }
}

function duplicateKeys(row) {
  const keys = [];
  const title = normalizeText(row.title);
  const content = normalizeText(row.content || row.post);
  const url = normalizeUrl(row.url || row.link);
  const titleSignature = titleDuplicateSignature(title);

  if (title) keys.push(`title:${title}`);
  if (titleSignature) keys.push(`title-signature:${titleSignature}`);
  if (url) keys.push(`url:${url}`);
  if (content.length >= 80) keys.push(`content:${content.slice(0, 500)}`);

  return keys;
}

function titleTokens(value) {
  return normalizeText(value)
    .split(' ')
    .filter(token => token.length >= 4 && !TITLE_STOP_WORDS.has(token));
}

function titleDuplicateSignature(value) {
  const tokens = [...new Set(titleTokens(value))].sort();
  return tokens.length >= 4 ? tokens.join(' ') : '';
}

function titleSimilarity(a, b) {
  const aTokens = new Set(titleTokens(a));
  const bTokens = new Set(titleTokens(b));
  if (aTokens.size < 4 || bTokens.size < 4) return 0;

  let common = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) common += 1;
  }

  return common / Math.min(aTokens.size, bTokens.size);
}

function rowTime(row) {
  const value = row.updated_at || row.created_at || row.date || '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function rank(row) {
  const status = row.status === 'published' || row.status === 'rejected' ? 2 : 1;
  return status * 10_000_000_000_000 + rowTime(row);
}

async function fetchAllNews() {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select('id,title,post,url,status,source,date,created_at,updated_at')
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

async function main() {
  const rows = await fetchAllNews();
  const groups = new Map();

  for (const row of rows) {
    for (const key of duplicateKeys(row)) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
  }

  const duplicateGroups = [];
  const deleteIds = [];
  const seenDeleteIds = new Set();
  const seenGroups = new Set();

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => rank(b) - rank(a));
    const groupKey = group.map(row => row.id).sort().join('|');
    if (seenGroups.has(groupKey)) continue;
    seenGroups.add(groupKey);
    duplicateGroups.push(group);
    for (const row of group.slice(1)) {
      if (seenDeleteIds.has(row.id)) continue;
      seenDeleteIds.add(row.id);
      deleteIds.push(row.id);
    }
  }

  for (const row of rows) {
    for (const candidate of rows) {
      if (row.id === candidate.id || titleSimilarity(row.title, candidate.title) < 0.86) continue;
      const group = [row, candidate].sort((a, b) => rank(b) - rank(a));
      const groupKey = group.map(item => item.id).sort().join('|');
      if (seenGroups.has(groupKey)) continue;
      seenGroups.add(groupKey);
      duplicateGroups.push(group);
      for (const item of group.slice(1)) {
        if (seenDeleteIds.has(item.id)) continue;
        seenDeleteIds.add(item.id);
        deleteIds.push(item.id);
      }
    }
  }

  console.log(`Noticias analisadas: ${rows.length}`);
  console.log(`Grupos repetidos: ${duplicateGroups.length}`);
  console.log(`Registos para apagar: ${deleteIds.length}`);

  duplicateGroups.slice(0, 10).forEach((group, index) => {
    console.log(`${index + 1}. manter "${group[0].title}" (${group[0].id}); apagar ${group.length - 1}`);
  });

  if (!apply || deleteIds.length === 0) return;

  const chunkSize = 100;
  for (let i = 0; i < deleteIds.length; i += chunkSize) {
    const chunk = deleteIds.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).delete().in('id', chunk);
    if (error) throw error;
    console.log(`Apagados ${Math.min(i + chunk.length, deleteIds.length)} de ${deleteIds.length}`);
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
