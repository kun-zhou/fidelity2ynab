/**
 * Chrome Storage utilities for simplified storage operations
 */

/**
 * Get a value from chrome.storage.local
 * @param {string} key - Storage key
 * @param {*} defaultValue - Default value if key doesn't exist
 * @returns {Promise<*>} The stored value or default
 */
function getStorageValue(key, defaultValue = null) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get([key], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(result[key] !== undefined ? result[key] : defaultValue);
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Set a value in chrome.storage.local
 * @param {string} key - Storage key
 * @param {*} value - Value to store
 * @returns {Promise<void>}
 */
function setStorageValue(key, value) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Get multiple values from chrome.storage.local
 * @param {string[]} keys - Array of storage keys
 * @returns {Promise<Object>} Object with key-value pairs
 */
function getStorageValues(keys) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.storageUtils = {
    getStorageValue,
    setStorageValue,
    getStorageValues
  };
}
