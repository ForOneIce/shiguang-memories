import { createArchive, validateArchive } from './archive.mjs';

const STORE_NAME = 'archive';
const LIBRARY_KEY = 'current';

export class StorageError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'StorageError';
    this.code = code;
  }
}

function isQuotaFailure(cause) {
  const visited = new Set();
  // Browsers and wrappers may retain the quota error beneath an AbortError.
  // Follow only a short cause chain; malformed or circular errors must not hang.
  for (let depth = 0; depth < 8 && cause && typeof cause === 'object'; depth += 1) {
    if (visited.has(cause)) break;
    visited.add(cause);
    if (cause.name === 'QuotaExceededError') return true;
    cause = cause.cause;
  }
  return false;
}

function storageFailure(cause, transactionCause) {
  if (isQuotaFailure(cause) || isQuotaFailure(transactionCause)) {
    return new StorageError(
      'STORAGE_FULL',
      '这次还没能保存：浏览器可用的空间暂时不足。原文件和之前保存的记录没有改变。可以先整理设备上不需要的文件，再回来重试；请先不要清除拾光的网站数据。',
      cause ?? transactionCause,
    );
  }
  if (cause instanceof StorageError) return cause;
  return new StorageError(
    'STORAGE_FAILED',
    '这次还没能保存。原文件和之前保存的记录没有改变。请保留当前页面，稍后再试；也可以先导出完整备份。',
    cause ?? transactionCause,
  );
}

/**
 * One atomic record contains conversations, notes and preferences. A successful
 * request is not a successful save: callers resolve only on transaction commit.
 * There is no network access or automatic deletion in this module.
 */
export function createArchiveStore({
  indexedDB = globalThis.indexedDB,
  databaseName = 'shiguang-library',
} = {}) {
  let connection;
  let opening;
  let knownRevision = 0;

  async function open() {
    if (!indexedDB?.open) {
      throw new StorageError(
        'STORAGE_UNAVAILABLE',
        '当前浏览器无法保存内容。请使用普通浏览窗口，并保留导入文件和导出的完整备份。',
      );
    }
    if (connection) return connection;
    if (opening) return opening;

    opening = new Promise((resolve, reject) => {
      let request;
      let abandoned = false;
      try {
        request = indexedDB.open(databaseName, 1);
      } catch (cause) {
        reject(storageFailure(cause));
        return;
      }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onblocked = () => {
        abandoned = true;
        reject(new StorageError(
          'STORAGE_BLOCKED',
          '另一个页面正在使用这份本地记录。请先备份并关闭其他拾光页面，再重试。',
        ));
      };
      request.onerror = () => reject(storageFailure(request.error));
      request.onsuccess = () => {
        const database = request.result;
        if (abandoned) {
          database.close();
          return;
        }
        connection = database;
        database.onversionchange = () => {
          database.close();
          if (connection === database) connection = undefined;
        };
        database.onclose = () => {
          if (connection === database) connection = undefined;
        };
        resolve(database);
      };
    });
    try {
      return await opening;
    } finally {
      opening = undefined;
    }
  }

  async function transact(mode, operation) {
    const database = await open();
    return new Promise((resolve, reject) => {
      let transaction;
      let result;
      let requestError;
      try {
        transaction = database.transaction(STORE_NAME, mode);
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(storageFailure(requestError, transaction.error));
        transaction.onerror = () => { requestError ??= transaction.error; };
        const request = operation(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => { requestError = request.error; };
      } catch (cause) {
        try { transaction?.abort(); } catch { /* An inactive transaction cannot commit. */ }
        reject(storageFailure(cause));
      }
    });
  }

  return {
    async readArchive() {
      const saved = await transact('readonly', store => store.get(LIBRARY_KEY));
      if (saved === undefined) {
        knownRevision = 0;
        return createArchive();
      }
      try {
        if (saved.version !== 1 || !Number.isSafeInteger(saved.revision) || saved.revision < 1) {
          throw new Error('Invalid local storage envelope');
        }
        const archive = validateArchive(saved.archive);
        knownRevision = saved.revision;
        return archive;
      } catch (cause) {
        throw new StorageError(
          'STORED_DATA_INVALID',
          '这份本地记录暂时无法读取。原有内容未被覆盖，请保留页面并使用之前导出的完整备份恢复。',
          cause,
        );
      }
    },
    async saveArchive(archive) {
      // Validate and detach before awaiting: later caller mutations must not leak
      // into the in-flight transaction or skip backup format validation.
      const snapshot = validateArchive(archive);
      const expectedRevision = knownRevision;
      const database = await open();
      await new Promise((resolve, reject) => {
        let transaction;
        let failure;
        try {
          transaction = database.transaction(STORE_NAME, 'readwrite');
          transaction.onabort = () => reject(storageFailure(failure, transaction.error));
          transaction.onerror = () => { failure ??= transaction.error; };
          transaction.oncomplete = () => {
            knownRevision = expectedRevision + 1;
            resolve();
          };
          const objectStore = transaction.objectStore(STORE_NAME);
          const current = objectStore.get(LIBRARY_KEY);
          current.onerror = () => { failure = current.error; };
          current.onsuccess = () => {
            try {
              const actualRevision = current.result?.revision ?? 0;
              if (actualRevision !== expectedRevision || (current.result && current.result.version !== 1)) {
                failure = new StorageError(
                  'STALE_STATE',
                  '另一个页面已保存了新内容。本次修改尚未保存，请先导出当前完整备份，再重新打开记录。',
                );
                transaction.abort();
                return;
              }
              const write = objectStore.put({
                version: 1,
                revision: expectedRevision + 1,
                archive: snapshot,
              }, LIBRARY_KEY);
              write.onerror = () => { failure = write.error; };
            } catch (cause) {
              failure = cause;
              transaction.abort();
            }
          };
        } catch (cause) {
          try { transaction?.abort(); } catch { /* Preserve the existing record. */ }
          reject(storageFailure(cause));
        }
      });
      return snapshot;
    },
    close() {
      connection?.close();
      connection = undefined;
    },
  };
}
