import { Store } from '@tauri-apps/plugin-store';

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load('.ai-sheet-secrets.json');
  }
  return store;
}

export async function getApiKey(key: string): Promise<string | null> {
  const s = await getStore();
  return s.get<string>(key).then(v => v ?? null);
}

export async function setApiKey(key: string, value: string): Promise<void> {
  const s = await getStore();
  await s.set(key, value);
  await s.save();
}

export async function deleteApiKey(key: string): Promise<void> {
  const s = await getStore();
  await s.delete(key);
  await s.save();
}

export async function getAllKeys(): Promise<string[]> {
  const s = await getStore();
  return s.keys();
}
