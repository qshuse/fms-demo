import { NavGraph } from '../types/rmf';

export interface TrafficMapDraft {
  id: string; // e.g. "building_name:level_name" or unique ID
  buildingName: string;
  levelName: string;
  updatedAt: number; // timestamp in ms
  waypointsCount: number;
  lanesCount: number;
  imageDataUrl?: string | null;
  imageFilename?: string | null;
  imageDimensions?: { width: number; height: number } | null;
  navGraph: NavGraph;
  meterScale?: number;
  isDirty?: boolean;
}

const DB_NAME = 'vntt_traffic_editor_db';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result as IDBDatabase;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const trafficDraftStorage = {
  /**
   * Save or update a map draft in IndexedDB
   */
  async saveDraft(draft: TrafficMapDraft): Promise<void> {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(draft);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[trafficDraftStorage] Error saving draft:', err);
    }
  },

  /**
   * Get a specific draft by its ID
   */
  async getDraft(id: string): Promise<TrafficMapDraft | null> {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[trafficDraftStorage] Error getting draft:', err);
      return null;
    }
  },

  /**
   * Get all drafts sorted by latest updatedAt descending
   */
  async getAllDrafts(): Promise<TrafficMapDraft[]> {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const list: TrafficMapDraft[] = req.result || [];
          list.sort((a, b) => b.updatedAt - a.updatedAt);
          resolve(list);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[trafficDraftStorage] Error listing drafts:', err);
      return [];
    }
  },

  /**
   * Get the most recently modified draft
   */
  async getLatestDraft(): Promise<TrafficMapDraft | null> {
    const list = await this.getAllDrafts();
    return list.length > 0 ? list[0] : null;
  },

  /**
   * Delete a draft by ID
   */
  async deleteDraft(id: string): Promise<void> {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[trafficDraftStorage] Error deleting draft:', err);
    }
  },

  /**
   * Clear all drafts
   */
  async clearAllDrafts(): Promise<void> {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[trafficDraftStorage] Error clearing drafts:', err);
    }
  },
};
