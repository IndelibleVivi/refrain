import {
  APPEARANCE_PREFERENCES_FORMAT,
  isRasterAppearanceImage,
  parseAppearancePreferences,
  type AppearancePreferences,
} from "./appearance.js";
import type { SelenV21ThemeId } from "./selen-v21-model.js";

export const APPEARANCE_STORAGE_KEY = "refrain:appearance@0";
const APPEARANCE_DATABASE = "refrain-appearance";
const BACKGROUND_STORE = "backgrounds";

interface ReadStorage {
  getItem(key: string): string | null;
}

interface WriteStorage extends ReadStorage {
  setItem(key: string, value: string): void;
}

const emptyPreferences = (): AppearancePreferences => ({
  format: APPEARANCE_PREFERENCES_FORMAT,
  themes: {},
});

export function readStoredAppearancePreferences(
  storage: ReadStorage = window.localStorage,
): AppearancePreferences {
  try {
    const value = storage.getItem(APPEARANCE_STORAGE_KEY);
    return value === null
      ? emptyPreferences()
      : parseAppearancePreferences(JSON.parse(value));
  } catch {
    return emptyPreferences();
  }
}

export function writeStoredAppearancePreferences(
  preferences: AppearancePreferences,
  storage: WriteStorage = window.localStorage,
): void {
  storage.setItem(
    APPEARANCE_STORAGE_KEY,
    JSON.stringify(parseAppearancePreferences(preferences)),
  );
}

function openAppearanceDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    return Promise.reject(new Error("Local image storage is unavailable."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(APPEARANCE_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BACKGROUND_STORE))
        request.result.createObjectStore(BACKGROUND_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Local image storage failed to open."));
    request.onblocked = () =>
      reject(new Error("Local image storage is blocked by another page."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ??
          new Error("Local image storage transaction failed."),
      );
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new Error("Local image storage transaction aborted."),
      );
  });
}

export async function readAppearanceBackground(
  theme: SelenV21ThemeId,
): Promise<Blob | undefined> {
  const database = await openAppearanceDatabase();
  try {
    const transaction = database.transaction(BACKGROUND_STORE, "readonly");
    const request = transaction.objectStore(BACKGROUND_STORE).get(theme);
    const value = await new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          request.error ?? new Error("Local background could not be read."),
        );
    });
    await transactionDone(transaction);
    return value instanceof Blob && isRasterAppearanceImage(value)
      ? value
      : undefined;
  } finally {
    database.close();
  }
}

export async function writeAppearanceBackground(
  theme: SelenV21ThemeId,
  blob: Blob,
): Promise<void> {
  if (!isRasterAppearanceImage(blob))
    throw new Error("The background must be a supported image up to 12 MB.");
  const database = await openAppearanceDatabase();
  try {
    const transaction = database.transaction(BACKGROUND_STORE, "readwrite");
    transaction.objectStore(BACKGROUND_STORE).put(blob, theme);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function deleteAppearanceBackground(
  theme: SelenV21ThemeId,
): Promise<void> {
  const database = await openAppearanceDatabase();
  try {
    const transaction = database.transaction(BACKGROUND_STORE, "readwrite");
    transaction.objectStore(BACKGROUND_STORE).delete(theme);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
