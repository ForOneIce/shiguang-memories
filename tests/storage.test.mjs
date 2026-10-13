import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createArchive } from '../src/lib/archive.mjs';
import { createArchiveStore } from '../src/lib/storage.mjs';

function fixture() {
  const archive = createArchive();
  archive.conversations = [{
    conversation_id: '9007199254740993001', conversation_name: '', bot_id: 'role-demo',
    bot_name: '示例角色', user_id: 'user-demo', messages: [{
      message_id: '9007199254740993011', conversation_id: '9007199254740993001',
      bot_id: 'role-demo', user_id: 'user-demo', user_type: 'user', content_type: 'text',
      show_content: '完全虚构的测试内容', create_time: '2026-10-13T02:00:00Z',
      update_time: '2026-10-13T02:00:00Z',
    }],
  }];
  archive.notes = [{
    id: 'note-demo', conversationId: '9007199254740993001', body: '今天的私人便笺',
    createdAt: '2026-10-13T03:00:00.000Z', updatedAt: '2026-10-13T03:00:00.000Z',
  }];
  archive.preferences = { theme: 'yellow', fontSize: 18, decorations: false };
  return archive;
}

test('conversations, separate notes and preferences survive closing and reopening', async () => {
  const indexedDB = new IDBFactory();
  const first = createArchiveStore({ indexedDB });
  assert.deepEqual(await first.readArchive(), createArchive());
  const data = fixture();
  await first.saveArchive(data);
  first.close();
  const second = createArchiveStore({ indexedDB });
  assert.deepEqual(await second.readArchive(), data);
  second.close();
});

test('an in-flight save takes a detached snapshot of the callers data', async () => {
  const store = createArchiveStore({ indexedDB: new IDBFactory() });
  const data = fixture();
  const expected = structuredClone(data);
  const pending = store.saveArchive(data);
  data.notes[0].body = '此修改尚未请求保存';
  data.conversations[0].messages[0].show_content = '调用方后续修改';
  await pending;
  assert.deepEqual(await store.readArchive(), expected);
  store.close();
});

test('invalid writes leave the last valid archive untouched', async () => {
  const store = createArchiveStore({ indexedDB: new IDBFactory() });
  const data = fixture();
  await store.saveArchive(data);
  await assert.rejects(store.saveArchive({ conversations: 'broken' }));
  assert.deepEqual(await store.readArchive(), data);
  store.close();
});

test('transaction abort after a successful put is a failed save and rolls back', async () => {
  const indexedDB = new IDBFactory();
  const databaseName = 'abort-test';
  const store = createArchiveStore({ indexedDB, databaseName });
  const original = fixture();
  await store.saveArchive(original);
  store.close();
  let abortWrites = true;
  const abortingFactory = {
    open(name, version) {
      const request = indexedDB.open(name, version);
      request.addEventListener('success', () => {
        const db = request.result;
        const transaction = db.transaction.bind(db);
        db.transaction = (...args) => {
          const tx = transaction(...args);
          if (args[1] === 'readwrite' && abortWrites) {
            const objectStore = tx.objectStore.bind(tx);
            tx.objectStore = name => {
              const object = objectStore(name);
              const put = object.put.bind(object);
              object.put = (...values) => {
                const write = put(...values);
                write.addEventListener('success', () => tx.abort());
                return write;
              };
              return object;
            };
          }
          return tx;
        };
      });
      return request;
    },
  };
  const failing = createArchiveStore({ indexedDB: abortingFactory, databaseName });
  await failing.readArchive();
  const changed = fixture();
  changed.notes[0].body = '不应该在失败后留下的文字';
  await assert.rejects(failing.saveArchive(changed), { code: 'STORAGE_FAILED' });
  abortWrites = false;
  assert.deepEqual(await failing.readArchive(), original);
  failing.close();
});

test('unavailable storage produces an actionable error, not a fake successful save', async () => {
  const store = createArchiveStore({ indexedDB: null });
  await assert.rejects(store.saveArchive(fixture()), { code: 'STORAGE_UNAVAILABLE' });
});

test('a stale browser tab cannot overwrite newer saved conversations or notes', async () => {
  const indexedDB = new IDBFactory();
  const first = createArchiveStore({ indexedDB });
  const second = createArchiveStore({ indexedDB });
  const data = fixture();
  await first.saveArchive(data);
  const stale = await second.readArchive();
  const newer = fixture();
  newer.notes[0].body = '另一个页面刚刚保存的新便笺';
  await first.saveArchive(newer);
  stale.notes[0].body = '尚未刷新页面中的修改';
  await assert.rejects(second.saveArchive(stale), { code: 'STALE_STATE' });
  assert.deepEqual(await first.readArchive(), newer);
  first.close();
  second.close();
});

// Inject browser storage failures without consuming actual device space. The
// underlying fake-indexeddb transactions still perform real commit/rollback.
function faultingFactory(indexedDB, fault) {
  return {
    open(name, version) {
      const request = indexedDB.open(name, version);
      request.addEventListener('success', () => {
        const database = request.result;
        const startTransaction = database.transaction.bind(database);
        database.transaction = (...args) => {
          const transaction = startTransaction(...args);
          if (args[1] !== 'readwrite' || !fault.enabled) return transaction;
          const getObjectStore = transaction.objectStore.bind(transaction);
          transaction.objectStore = name => {
            const objectStore = getObjectStore(name);
            const put = objectStore.put.bind(objectStore);
            objectStore.put = (...values) => {
              if (fault.mode === 'sync') throw fault.error;
              if (fault.mode === 'request') {
                // This existing key causes a genuine asynchronous request error.
                // Replace its exposed cause to model a browser quota rejection.
                const write = objectStore.add(...values);
                write.addEventListener('error', () => {
                  Object.defineProperty(write, 'error', { value: fault.error });
                });
                if (fault.transactionError) {
                  transaction.addEventListener('abort', () => {
                    Object.defineProperty(transaction, 'error', { value: fault.transactionError });
                  });
                }
                return write;
              }
              const write = put(...values);
              write.addEventListener('success', () => {
                transaction.abort();
                Object.defineProperty(transaction, 'error', { value: fault.error });
              });
              return write;
            };
            return objectStore;
          };
          return transaction;
        };
      });
      return request;
    },
  };
}

async function assertRollbackAndRetry({ mode, error, transactionError, expectedCode }) {
  const indexedDB = new IDBFactory();
  const original = fixture();
  const initial = createArchiveStore({ indexedDB });
  await initial.saveArchive(original);
  initial.close();

  const fault = { mode, error, transactionError, enabled: true };
  const store = createArchiveStore({ indexedDB: faultingFactory(indexedDB, fault) });
  const observer = createArchiveStore({ indexedDB });
  try {
    await store.readArchive();
    const changed = fixture();
    changed.conversations[0].messages.push({
      ...changed.conversations[0].messages[0],
      message_id: 'synthetic-new-message',
      show_content: '新导入的虚构内容',
    });
    changed.notes[0].body = '尚未保存的新便笺';
    changed.preferences.theme = 'purple';
    await assert.rejects(store.saveArchive(changed), failure => {
      assert.equal(failure.code, expectedCode);
      assert.match(failure.message, /这次还没能保存/);
      assert.match(failure.message, /原文件和之前保存的记录没有改变/);
      assert.doesNotMatch(failure.message, /PRIVATE_ERROR_DETAILS/);
      if (expectedCode === 'STORAGE_FULL') {
        assert.match(failure.message, /请先不要清除拾光的网站数据/);
      }
      return true;
    });
    assert.deepEqual(await observer.readArchive(), original);

    // Do not reload the failing store: retry must work with its existing revision.
    fault.enabled = false;
    await store.saveArchive(changed);
    assert.deepEqual(await observer.readArchive(), changed);
  } finally {
    store.close();
    observer.close();
  }
}

for (const mode of ['sync', 'request', 'transaction']) {
  test(`quota failure during ${mode} write preserves all existing data and permits retry`, async () => {
    await assertRollbackAndRetry({
      mode,
      error: new DOMException('PRIVATE_ERROR_DETAILS', 'QuotaExceededError'),
      expectedCode: 'STORAGE_FULL',
    });
  });
}

test('a quota error wrapped in an abort cause is recognized and rolled back', async () => {
  await assertRollbackAndRetry({
    mode: 'transaction',
    error: Object.assign(new DOMException('PRIVATE_ERROR_DETAILS', 'AbortError'), {
      cause: new Error('wrapper', { cause: new DOMException('quota', 'QuotaExceededError') }),
    }),
    expectedCode: 'STORAGE_FULL',
  });
});

test('a generic request abort does not hide the transaction quota error', async () => {
  await assertRollbackAndRetry({
    mode: 'request',
    error: new DOMException('PRIVATE_ERROR_DETAILS', 'AbortError'),
    transactionError: new DOMException('quota', 'QuotaExceededError'),
    expectedCode: 'STORAGE_FULL',
  });
});

for (const name of ['AbortError', 'UnknownError']) {
  test(`${name} alone is not incorrectly described as insufficient space`, async () => {
    await assertRollbackAndRetry({
      mode: 'transaction',
      error: new DOMException('PRIVATE_ERROR_DETAILS: quota or disk', name),
      expectedCode: 'STORAGE_FAILED',
    });
  });
}

test('cyclic causes remain a generic failure and do not block retry', async () => {
  const error = new Error('PRIVATE_ERROR_DETAILS');
  error.cause = new Error('wrapper', { cause: error });
  await assertRollbackAndRetry({ mode: 'sync', error, expectedCode: 'STORAGE_FAILED' });
});

test('cause inspection has a finite depth for excessively wrapped failures', async () => {
  let error = new DOMException('PRIVATE_ERROR_DETAILS', 'QuotaExceededError');
  for (let depth = 0; depth < 12; depth += 1) error = new Error('wrapper', { cause: error });
  await assertRollbackAndRetry({ mode: 'sync', error, expectedCode: 'STORAGE_FAILED' });
});

test('a database-open quota failure also returns the actionable storage error', async () => {
  const store = createArchiveStore({
    indexedDB: {
      open() {
        throw new Error('PRIVATE_ERROR_DETAILS', {
          cause: new DOMException('quota', 'QuotaExceededError'),
        });
      },
    },
  });
  await assert.rejects(store.saveArchive(fixture()), { code: 'STORAGE_FULL' });
});
