import test from 'node:test';
import assert from 'node:assert/strict';
import { addNote, createArchive, importArchive } from '../src/lib/archive.mjs';
import {
  prepareFileImport, createExportFile,
  IMPORT_FILE_REVIEW_BYTES, IMPORT_BATCH_REVIEW_BYTES,
} from '../src/lib/backup-files.mjs';

function conversation(id) {
  return {
    conversation_id: id, conversation_name: '', bot_id: 'role-'+id, bot_name: '虚构角色',
    user_id: 'demo-user', messages: [{
      message_id: 'msg-'+id, conversation_id: id, bot_id: 'role-'+id, user_id: 'demo-user',
      user_type: 'bot', content_type: 'text', show_content: '虚构测试记录',
      create_time: '2026-10-13T01:02:03Z', update_time: '2026-10-13T01:02:03Z',
    }],
  };
}
function file(name, content) {
  return { name, text: async () => content };
}

test('multi-file import prepares one complete result without mutating existing data', async () => {
  const current = createArchive();
  const result = await prepareFileImport([
    file('first.json', JSON.stringify([conversation('first')])),
    file('second.json', JSON.stringify([conversation('second')])),
  ], current);
  assert.equal(result.archive.conversations.length, 2);
  assert.equal(result.reports.length, 2);
  assert.deepEqual(current, createArchive());
});

test('a damaged later file cannot leave a partially imported library', async () => {
  const current = importArchive(JSON.stringify([conversation('existing')])).archive;
  const before = structuredClone(current);
  await assert.rejects(prepareFileImport([
    file('valid.json', JSON.stringify([conversation('new')])),
    file('bad.json', 'not JSON'),
  ], current), { code: 'INVALID_JSON' });
  assert.deepEqual(current, before);
});

test('a failed file read and empty file selection return actionable failures', async () => {
  await assert.rejects(prepareFileImport([]), { code: 'NO_FILES' });
  await assert.rejects(prepareFileImport([{ name: 'backup.json', text: async () => { throw new Error('read failed'); } }]),
    { code: 'FILE_READ_FAILED' });
});

test('large file metadata requests review before any file read or archive clone', async () => {
  let reads = 0;
  let archiveTouched = false;
  const current = { get conversations() { archiveTouched = true; throw new Error('must not clone'); } };
  await assert.rejects(prepareFileImport([
    { name: 'first.json', size: 2, text: async () => { reads += 1; return '[]'; } },
    { name: 'large.json', size: IMPORT_FILE_REVIEW_BYTES + 1, text: async () => { reads += 1; return '[]'; } },
  ], current), { code: 'LARGE_FILE_REVIEW' });
  assert.equal(reads, 0);
  assert.equal(archiveTouched, false);
});

test('a large batch requests review before its first file is read', async () => {
  let reads = 0;
  const selected = [IMPORT_FILE_REVIEW_BYTES, IMPORT_FILE_REVIEW_BYTES, 1].map((size, i) => ({
    name: `${i}.json`, size, text: async () => { reads += 1; return '[]'; },
  }));
  await assert.rejects(prepareFileImport(selected), { code: 'LARGE_BATCH_REVIEW' });
  assert.equal(reads, 0);
});

test('exact file and batch review thresholds are accepted without allocating large fixtures', async () => {
  assert.equal(IMPORT_FILE_REVIEW_BYTES, 25 * 1024 * 1024);
  assert.equal(IMPORT_BATCH_REVIEW_BYTES, 50 * 1024 * 1024);
  const selected = ['first', 'second'].map(id => ({
    name: `${id}.json`, size: IMPORT_FILE_REVIEW_BYTES,
    text: async () => JSON.stringify([conversation(id)]),
  }));
  const result = await prepareFileImport(selected);
  assert.equal(result.archive.conversations.length, 2);
});

test('reviewed large full backups can be restored without a permanent import size limit', async () => {
  const imported = importArchive(JSON.stringify([conversation('large-backup')])).archive;
  const archive = addNote(imported, {
    id: 'large-backup-note', conversationId: 'large-backup', body: '一份独立便笺',
    createdAt: '2026-10-13T03:00:00.000Z',
  });
  const fullBackup = createExportFile(archive);
  const selected = [{
    name: fullBackup.filename, size: IMPORT_BATCH_REVIEW_BYTES + 1,
    text: async () => fullBackup.content,
  }];
  await assert.rejects(prepareFileImport(selected), { code: 'LARGE_FILE_REVIEW' });
  const result = await prepareFileImport(selected, createArchive(), { allowLargeFiles: true });
  assert.deepEqual(result.archive, archive);
});

test('continuing a large import retains format checks and conflict atomicity', async () => {
  const existing = conversation('existing-large');
  const current = importArchive(JSON.stringify([existing])).archive;
  const before = structuredClone(current);
  const conflict = structuredClone(existing);
  conflict.messages[0].show_content = 'a different message';
  const largeFile = content => ({
    name: 'large.json', size: IMPORT_FILE_REVIEW_BYTES + 1,
    text: async () => content,
  });
  await assert.rejects(prepareFileImport([
    largeFile('not JSON'),
  ], current, { allowLargeFiles: true }), { code: 'INVALID_JSON' });
  await assert.rejects(prepareFileImport([
    largeFile(JSON.stringify([conversation('new-large')])),
    largeFile(JSON.stringify([conflict])),
  ], current, { allowLargeFiles: true }), { code: 'MESSAGE_CONFLICT' });
  assert.deepEqual(current, before);
});

test('invalid metadata later in a batch is checked before reading earlier files', async () => {
  let reads = 0;
  for (const size of [-1, NaN, Infinity, '100', 0.5]) {
    await assert.rejects(prepareFileImport([
      { name: 'first.json', size: 2, text: async () => { reads += 1; return '[]'; } },
      { name: 'invalid.json', size, text: async () => { reads += 1; return '[]'; } },
    ]), { code: 'INVALID_FILE' });
  }
  assert.equal(reads, 0);
});

test('file-like inputs without size use UTF-8 bytes in the batch total', async () => {
  const example = conversation('unicode');
  example.messages[0].show_content = '🌸备忘录';
  const content = JSON.stringify([example]);
  const utf8Bytes = Buffer.byteLength(content, 'utf8');
  assert.ok(utf8Bytes > content.length);
  const selection = extraBytes => [
    { name: 'first.json', size: IMPORT_FILE_REVIEW_BYTES, text: async () => '[]' },
    { name: 'second.json', size: IMPORT_FILE_REVIEW_BYTES - utf8Bytes + extraBytes, text: async () => '[]' },
    file('unknown-size.json', content),
  ];
  const current = createArchive();
  const before = structuredClone(current);
  await assert.rejects(prepareFileImport(selection(1), current), { code: 'LARGE_BATCH_REVIEW' });
  assert.deepEqual(current, before);
  const result = await prepareFileImport(selection(0), current);
  assert.equal(result.archive.conversations.length, 1);
});

test('read failures and resource limits do not expose system error text', async () => {
  const privateSystemMessage = 'system path and private context must stay hidden';
  for (const [error, code] of [
    [new Error(privateSystemMessage), 'FILE_READ_FAILED'],
    [new RangeError(privateSystemMessage), 'IMPORT_RESOURCE_LIMIT'],
    [{ name: 'RangeError', message: privateSystemMessage }, 'IMPORT_RESOURCE_LIMIT'],
  ]) {
    const current = createArchive();
    await assert.rejects(prepareFileImport([
      { name: 'unavailable.json', size: 2, text: async () => { throw error; } },
    ], current), failure => {
      assert.equal(failure.code, code);
      assert.equal(failure.message.includes(privateSystemMessage), false);
      assert.match(failure.message, /原文件和已保存的记录都没有改变/);
      return true;
    });
    assert.deepEqual(current, createArchive());
  }
  await assert.rejects(prepareFileImport([
    { name: 'invalid-text.json', text: async () => null },
  ]), { code: 'FILE_READ_FAILED' });
});

test('a later message conflict preserves the original archive and conflict error', async () => {
  const existing = conversation('existing');
  const current = importArchive(JSON.stringify([existing])).archive;
  const before = structuredClone(current);
  const conflict = structuredClone(existing);
  conflict.messages[0].show_content = 'a different value for the same message';
  await assert.rejects(prepareFileImport([
    file('new.json', JSON.stringify([conversation('new')])),
    file('conflict.json', JSON.stringify([conflict])),
  ], current), { code: 'MESSAGE_CONFLICT' });
  assert.deepEqual(current, before);
});

test('portable downloaded JSON restores notes while original-format downloaded JSON excludes them', () => {
  const original = [conversation('example')];
  const imported = importArchive(JSON.stringify(original)).archive;
  const archive = addNote(imported, {
    id: 'note-example', conversationId: 'example', body: '独立便笺，不是角色消息',
    createdAt: '2026-10-13T03:00:00.000Z',
  });
  const now = new Date('2026-10-13T04:05:06.000Z');
  const full = createExportFile(archive, { now });
  const plain = createExportFile(archive, { now, kind: 'conversations' });
  assert.match(full.filename, /^shiguang-backup-\d{4}-\d{2}-\d{2}-\d{6}\.json$/);
  assert.match(plain.filename, /^shiguang-conversations-\d{4}-\d{2}-\d{2}-\d{6}\.json$/);
  assert.equal(full.mimeType, 'application/json;charset=utf-8');
  assert.deepEqual(importArchive(full.content).archive, archive);
  assert.deepEqual(JSON.parse(plain.content), original);
  assert.equal(JSON.parse(full.content).exportedAt, now.toISOString());
});
