export const VALID_SECTORS = ['maritimo', 'defesa-militar', 'aeroespacial', 'ferroviario'];

const g = globalThis;
if (!g._newsStore) g._newsStore = [];

export function getStore() {
  return g._newsStore;
}

export function addToStore(item) {
  g._newsStore.unshift(item);
  if (g._newsStore.length > 500) g._newsStore.length = 500;
}
