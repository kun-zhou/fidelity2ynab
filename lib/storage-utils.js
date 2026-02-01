/**
 * Storage Utilities
 */

async function getStorageValue(key, defaultValue = null) {
  const result = await browser.storage.local.get([key]);
  return result[key] ?? defaultValue;
}

async function setStorageValue(key, value) {
  await browser.storage.local.set({ [key]: value });
}

async function getStorageValues(keys) {
  return await browser.storage.local.get(keys);
}
