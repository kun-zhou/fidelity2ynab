/**
 * Storage Utilities
 */

function getStorageValue(key, defaultValue = null) {
  return new Promise(resolve => {
    browser.storage.local.get([key], result => resolve(result[key] ?? defaultValue));
  });
}

function setStorageValue(key, value) {
  return new Promise(resolve => {
    browser.storage.local.set({ [key]: value }, resolve);
  });
}

function getStorageValues(keys) {
  return new Promise(resolve => {
    browser.storage.local.get(keys, resolve);
  });
}
