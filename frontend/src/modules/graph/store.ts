import { configureStore, createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { Preferences } from './types';
export function defaultPreferences(): Preferences {
  return { positions: {}, routes: {}, groups: [], annotations: [], hidden: [],
    filters: { resource: '', state: '', district: '', incidentsOnly: false } };
}
const slice = createSlice({
  name: 'graph', initialState: { present: defaultPreferences(), past: [] as Preferences[], future: [] as Preferences[] },
  reducers: {
    edit(state, action: PayloadAction<Partial<Preferences>>) {
      state.past.push(state.present); if (state.past.length > 40) state.past.shift();
      state.present = { ...state.present, ...action.payload }; state.future = [];
    },
    // Служебное обновление топологии не является действием пользователя.
    // Старую историю очищаем, чтобы undo не вернул удалённые сервером объекты.
    reconcile(state, action: PayloadAction<Partial<Preferences>>) {
      state.present = { ...state.present, ...action.payload }; state.past = []; state.future = [];
    },
    viewport(state, action: PayloadAction<Preferences['viewport']>) { state.present.viewport = action.payload; },
    undo(state) { const prev = state.past.pop(); if (prev) { state.future.push(state.present); state.present = prev; } },
    redo(state) { const next = state.future.pop(); if (next) { state.past.push(state.present); state.present = next; } },
  },
});
export const graphActions = slice.actions;
export function createGraphStore(preferences: Preferences) {
  return configureStore({ reducer: slice.reducer, preloadedState: { present: preferences, past: [], future: [] } });
}
export type GraphStore = ReturnType<typeof createGraphStore>;
export type GraphState = ReturnType<GraphStore['getState']>;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('infrastructure-map', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('preferences');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadPreferences(key: string): Promise<Preferences> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('preferences').objectStore('preferences').get(key);
      request.onsuccess = () => resolve({ ...defaultPreferences(), ...request.result });
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function savePreferences(key: string, preferences: Preferences) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('preferences', 'readwrite');
      transaction.objectStore('preferences').put(preferences, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
