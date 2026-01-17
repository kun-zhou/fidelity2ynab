/**
 * Chrome Storage Utilities
 */

function getStorageValue(key, defaultValue = null) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], result => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result[key] ?? defaultValue);
    });
  });
}

function setStorageValue(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

function getStorageValues(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, result => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result);
    });
  });
}
