import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ArchiveError, BACKUP_FORMAT, BACKUP_VERSION, DEFAULT_PREFERENCES,
  createArchive, validateArchive, importArchive, exportConversations, exportFullBackup,
  addNote, updateNote, deleteNote, setPreferences,
} from '../src/lib/archive.mjs';

const TIME = '2026-10-13T10:00:00.000Z';
const LATER = '2026-10-13T11:00:00.000Z';

// Fictional data only. Tests never read an actual person's backup.
function conversation(id = '900719925474099312345', botId = 'bot-a') {
  return {
    conversation_id: id,
    conversation_name: '',
    bot_id: botId,
    bot_name: botId === 'bot-a' ? '纸风车' : '小行星',
    user_id: 'user-demo',
    source_extension: { labels: ['虚构测试'], nested: { preserved: true } },
    messages: [
      {
        message_id: `${id}-1`, conversation_id: id, bot_id: botId, user_id: 'user-demo',
        user_type: 'user', content_type: 'text',
        show_content: '{"text":"今天看见一朵云。","literal":"\\n"}',
        create_time: TIME, update_time: TIME,
        extra: { untouched: ['text', 12, null] },
      },
      {
        message_id: `${id}-2`, conversation_id: id, bot_id: botId, user_id: 'user-demo',
        user_type: 'bot', content_type: 'future-card-type',
        show_content: '{"card":{"title":"云朵收藏"}}',
        create_time: TIME, update_time: TIME, reply_id: `${id}-1`,
      },
    ],
  };
}

function imported(items = [conversation()]) {
  return importArchive(JSON.stringify(items)).archive;
}

function withNote() {
  return addNote(imported(), {
    id: 'note-example', conversationId: conversation().conversation_id,
    body: '这是一页给现在的自己的便笺。', createdAt: TIME,
  });
}

function expectCode(action, code) {
  assert.throws(action, (error) => error instanceof ArchiveError && error.code === code);
}

test('original JSON roundtrip retains long string IDs, all unknown fields and opaque contents', () => {
  const source = [conversation()];
  const state = imported(source);
  assert.deepEqual(JSON.parse(exportConversations(state)), source);
  assert.equal(state.conversations[0].messages[0].show_content, source[0].messages[0].show_content);
  assert.equal(typeof state.conversations[0].conversation_id, 'string');
  assert.deepEqual(state.preferences, DEFAULT_PREFERENCES);
});

test('BOM is accepted; empty archive can be exported and restored', () => {
  assert.equal(importArchive(`\uFEFF${JSON.stringify([conversation()])}`).archive.conversations.length, 1);
  assert.deepEqual(importArchive(exportFullBackup(createArchive(), { exportedAt: TIME })).archive, createArchive());
});

test('multiple roles and multiple conversations for one role survive incremental file imports', () => {
  const first = imported([conversation('c1', 'bot-a')]);
  const before = structuredClone(first);
  const result = importArchive(JSON.stringify([
    conversation('c2', 'bot-b'), conversation('c3', 'bot-a'),
  ]), first);
  assert.deepEqual(result.archive.conversations.map((item) => item.conversation_id), ['c1', 'c2', 'c3']);
  assert.equal(result.report.addedConversations, 2);
  assert.equal(result.report.addedMessages, 4);
  assert.equal(result.report.skippedMessages, 0);
  assert.deepEqual(first, before);
});

test('reimport is idempotent even when JSON object key order differs', () => {
  const original = conversation();
  const reversed = Object.fromEntries(Object.entries(original).reverse());
  const state = imported([original]);
  const result = importArchive(JSON.stringify([reversed]), state);
  assert.deepEqual(result.archive, state);
  assert.equal(result.report.skippedConversations, 1);
  assert.equal(result.report.addedConversations, 0);
  assert.equal(result.report.mergedConversations, 0);
  assert.equal(result.report.addedMessages, 0);
  assert.equal(result.report.skippedMessages, 2);
});

test('overlapping snapshots merge new messages, preserve original ordering and retain unknown metadata', () => {
  const original = conversation();
  original.source_extension = JSON.parse('{"__proto__":{"kept":true},"nested":{"value":"preserved"}}');
  const state = imported([original]);
  const before = structuredClone(state);
  const newer = structuredClone(original);
  const newMessage = {
    ...newer.messages[0], message_id: 'new-message',
    create_time: '2026-10-12T10:00:00.000Z',
    future_field: { original: ['intact'] },
  };
  // Incoming order and timestamps do not rearrange already saved history.
  newer.messages = [newMessage, newer.messages[1], newer.messages[0]];
  const result = importArchive(JSON.stringify([newer]), state);
  const merged = result.archive.conversations[0];
  assert.deepEqual(merged.messages.map((message) => message.message_id),
    [original.messages[0].message_id, original.messages[1].message_id, 'new-message']);
  assert.deepEqual(merged.source_extension, original.source_extension);
  assert.deepEqual(merged.messages[2], newMessage);
  assert.deepEqual(state, before);
  assert.equal(result.report.mergedConversations, 1);
  assert.equal(result.report.addedConversations, 0);
  assert.equal(result.report.skippedConversations, 0);
  assert.equal(result.report.addedMessages, 1);
  assert.equal(result.report.skippedMessages, 2);
  const older = importArchive(JSON.stringify([original]), result.archive);
  assert.deepEqual(older.archive, result.archive);
  assert.equal(older.report.skippedConversations, 1);
  assert.equal(older.report.skippedMessages, 2);
  assert.equal(older.report.mergedConversations, 0);
});

test('conflicting non-message metadata rejects the batch without dropping unknown fields', () => {
  const state = imported();
  const before = structuredClone(state);
  for (const change of [
    (item) => { item.bot_name = '另一个名字'; },
    (item) => { item.source_extension.nested.preserved = false; },
    (item) => { delete item.source_extension; },
    (item) => { item.new_metadata = 'cannot silently choose'; },
  ]) {
    const conflicting = conversation();
    change(conflicting);
    expectCode(() => importArchive(JSON.stringify([conversation('new-id'), conflicting]), state), 'CONVERSATION_CONFLICT');
    assert.deepEqual(state, before);
  }
});

test('a conflicting message rejects the whole batch without overwriting or adding anything', () => {
  const state = imported();
  const before = structuredClone(state);
  const conflicting = conversation();
  conflicting.messages[0].show_content = 'private-conflict-body';
  // An earlier appended message must also be discarded if a later one conflicts.
  conflicting.messages.unshift({ ...conversation().messages[0], message_id: 'would-be-new' });
  expectCode(() => importArchive(JSON.stringify([conversation('new-id'), conflicting]), state), 'MESSAGE_CONFLICT');
  assert.deepEqual(state, before);
  assert.throws(() => importArchive(JSON.stringify([conflicting]), state), (error) => {
    assert.equal(error.message.includes('private-conflict-body'), false);
    return true;
  });
});

test('private notes stay outside original history through edits, export and removal', () => {
  const base = imported();
  const state = withNote();
  const edited = updateNote(state, 'note-example', '继续记录今天的小事。', { updatedAt: LATER });
  assert.equal(base.notes.length, 0);
  assert.notEqual(state.notes[0].body, edited.notes[0].body);
  assert.equal(edited.notes[0].updatedAt, LATER);
  assert.deepEqual(JSON.parse(exportConversations(edited)), [conversation()]);
  assert.equal(deleteNote(edited, 'note-example').notes.length, 0);
  assert.equal(edited.notes.length, 1);
});

test('complete backup restores conversations, separate notes and all preferences on an empty device', () => {
  const state = setPreferences(withNote(), { theme: 'purple', fontSize: 20, decorations: false });
  const json = exportFullBackup(state, { exportedAt: TIME });
  const envelope = JSON.parse(json);
  assert.equal(envelope.format, BACKUP_FORMAT);
  assert.equal(envelope.version, BACKUP_VERSION);
  assert.equal(envelope.exportedAt, TIME);
  const result = importArchive(json);
  assert.deepEqual(result.archive, state);
  assert.equal(result.report.preferenceSource, 'backup');
  const repeated = importArchive(json, state);
  assert.deepEqual(repeated.archive, state);
  assert.equal(repeated.report.skippedConversations, 1);
  assert.equal(repeated.report.skippedNotes, 1);
});

test('original JSON import retains current appearance while complete import restores backup appearance', () => {
  const initial = createArchive({ preferences: { theme: 'yellow' } });
  const result = importArchive(JSON.stringify([conversation()]), initial);
  assert.equal(result.archive.preferences.theme, 'yellow');
  assert.equal(result.report.preferenceSource, 'current');
  const backup = exportFullBackup(setPreferences(result.archive, { theme: 'purple' }), { exportedAt: TIME });
  assert.equal(importArchive(backup, result.archive).archive.preferences.theme, 'purple');
});

test('conflicting notes are not silently overwritten', () => {
  const state = withNote();
  const before = structuredClone(state);
  const changed = updateNote(state, 'note-example', '另一个版本', { updatedAt: LATER });
  expectCode(() => importArchive(exportFullBackup(changed, { exportedAt: TIME }), state), 'NOTE_CONFLICT');
  assert.deepEqual(state, before);
});

test('malformed JSON and unrelated objects give clear errors without echoing the file', () => {
  expectCode(() => importArchive('{private-invalid-json'), 'INVALID_JSON');
  expectCode(() => importArchive('{}'), 'UNSUPPORTED_FORMAT');
  expectCode(() => importArchive('null'), 'INVALID_STRUCTURE');
  expectCode(() => importArchive('"text"'), 'INVALID_STRUCTURE');
  expectCode(() => importArchive('[{}]'), 'INVALID_STRUCTURE');
});

test('a parsing resource limit is not described as malformed JSON and changes no input', (t) => {
  const state = withNote();
  const previous = structuredClone(state);
  const source = JSON.stringify([conversation('incoming')]);
  const previousSource = source;
  const parse = JSON.parse;
  t.mock.method(JSON, 'parse', function (text, ...args) {
    if (text === source) throw new RangeError('PRIVATE_ERROR_DETAILS');
    return parse.call(this, text, ...args);
  });
  assert.throws(() => importArchive(source, state), (error) => {
    assert.equal(error.code, 'IMPORT_RESOURCE_LIMIT');
    assert.match(error.message, /需要更多运行空间/);
    assert.match(error.message, /原文件和之前保存的记录没有改变/);
    assert.match(error.message, /关闭不用的标签页/);
    assert.doesNotMatch(error.message, /PRIVATE_ERROR_DETAILS|格式不|重新导出/);
    return true;
  });
  assert.deepEqual(state, previous);
  assert.equal(source, previousSource);
});

test('a cloning resource limit keeps existing records intact and asks to retain the source', (t) => {
  const state = withNote();
  const previous = structuredClone(state);
  const source = JSON.stringify([conversation('incoming')]);
  const previousSource = source;
  const stringify = JSON.stringify;
  t.mock.method(JSON, 'stringify', function (value, ...args) {
    if (value === state) throw new RangeError('PRIVATE_ERROR_DETAILS');
    return stringify.call(this, value, ...args);
  });
  assert.throws(() => importArchive(source, state), (error) => {
    assert.equal(error.code, 'IMPORT_RESOURCE_LIMIT');
    assert.match(error.message, /换一台设备再试/);
    assert.match(error.message, /请保留原文件，不需要修改其中的内容/);
    assert.doesNotMatch(error.message, /PRIVATE_ERROR_DETAILS|格式不|换一份备份/);
    return true;
  });
  assert.deepEqual(state, previous);
  assert.equal(source, previousSource);
});

test('numeric IDs, non-string content and messages attached to the wrong conversation are rejected', () => {
  for (const field of ['conversation_id', 'bot_id', 'user_id']) {
    const bad = conversation();
    bad[field] = 123;
    expectCode(() => imported([bad]), 'INVALID_STRUCTURE');
  }
  const wrongContent = conversation();
  wrongContent.messages[0].show_content = { text: '不应改变原格式' };
  expectCode(() => imported([wrongContent]), 'INVALID_STRUCTURE');
  const wrongReference = conversation();
  wrongReference.messages[0].conversation_id = 'other';
  expectCode(() => imported([wrongReference]), 'INVALID_REFERENCE');
});

test('duplicate conversations and messages are detected inside a file and across new conversations', () => {
  expectCode(() => imported([conversation(), conversation()]), 'DUPLICATE_CONVERSATION');
  const bad = conversation();
  bad.messages.push(structuredClone(bad.messages[0]));
  expectCode(() => imported([bad]), 'DUPLICATE_MESSAGE');
  const first = imported([conversation('first')]);
  const second = conversation('second');
  second.messages[0].message_id = 'first-1';
  expectCode(() => importArchive(JSON.stringify([second]), first), 'DUPLICATE_MESSAGE');
  assert.equal(first.conversations.length, 1);
});

test('unsupported backup version, invalid timestamps, missing fields and unknown fields are rejected', () => {
  const base = JSON.parse(exportFullBackup(withNote(), { exportedAt: TIME }));
  for (const version of [2, '1', null]) {
    expectCode(() => importArchive(JSON.stringify({ ...base, version })), 'UNSUPPORTED_VERSION');
  }
  expectCode(() => importArchive(JSON.stringify({ ...base, exportedAt: 'not-a-date' })), 'INVALID_TIMESTAMP');
  expectCode(() => importArchive(JSON.stringify({ ...base, exportedAt: '2026-02-30T10:00:00.000Z' })), 'INVALID_TIMESTAMP');
  const missing = { ...base };
  delete missing.notes;
  expectCode(() => importArchive(JSON.stringify(missing)), 'INVALID_STRUCTURE');
  expectCode(() => importArchive(JSON.stringify({ ...base, future: 'cannot silently drop' })), 'INVALID_STRUCTURE');
});

test('note references, duplicate IDs, body types and timestamp ordering are checked', () => {
  const state = withNote();
  const base = JSON.parse(exportFullBackup(state, { exportedAt: TIME }));
  const orphan = structuredClone(base);
  orphan.notes[0].conversationId = 'missing';
  expectCode(() => importArchive(JSON.stringify(orphan)), 'INVALID_REFERENCE');
  const duplicates = structuredClone(base);
  duplicates.notes.push(structuredClone(duplicates.notes[0]));
  expectCode(() => importArchive(JSON.stringify(duplicates)), 'DUPLICATE_NOTE');
  expectCode(() => addNote(state, { id: 'note-example', conversationId: conversation().conversation_id, body: 'x' }), 'DUPLICATE_NOTE');
  expectCode(() => updateNote(state, 'note-example', 42, { updatedAt: LATER }), 'INVALID_STRUCTURE');
  expectCode(() => updateNote(state, 'note-example', 'x', { updatedAt: '2026-10-12T10:00:00.000Z' }), 'INVALID_TIMESTAMP');
  expectCode(() => deleteNote(state, 'missing'), 'NOTE_NOT_FOUND');
});

test('appearance is a strict whitelist with valid value types', () => {
  const state = createArchive();
  for (const changes of [{ theme: 'unknown' }, { fontSize: 13 }, { fontSize: 23 },
    { fontSize: 16.5 }, { fontSize: '16' }, { decorations: 'yes' }]) {
    expectCode(() => setPreferences(state, changes), 'INVALID_PREFERENCES');
  }
  expectCode(() => setPreferences(state, { unknown: true }), 'INVALID_STRUCTURE');
  expectCode(() => setPreferences(state, JSON.parse('{"__proto__":{"polluted":true}}')), 'INVALID_STRUCTURE');
  assert.deepEqual(state.preferences, DEFAULT_PREFERENCES);
});

test('untrusted unknown keys are preserved as own JSON data without prototype pollution', () => {
  const source = conversation();
  source.source_extension = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"html":"<script>alert(1)</script>"}');
  const result = imported([source]);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(result.conversations[0].source_extension, '__proto__'), true);
  assert.deepEqual(JSON.parse(exportConversations(result)), [source]);
});

test('unsafe numeric values cannot be rounded or changed silently', () => {
  const raw = JSON.stringify([conversation()]).replace('"preserved":true', '"preserved":9007199254740993');
  expectCode(() => importArchive(raw), 'UNSAFE_NUMBER');
  const nonfinite = JSON.stringify([conversation()]).replace('"preserved":true', '"preserved":1e400');
  expectCode(() => importArchive(nonfinite), 'UNSAFE_NUMBER');
});

test('persisted-state validation returns an independent clone and rejects lossy non-JSON values', () => {
  const state = withNote();
  const cloned = validateArchive(state);
  cloned.conversations[0].messages[0].show_content = 'independent';
  assert.notEqual(cloned.conversations[0].messages[0].show_content, state.conversations[0].messages[0].show_content);
  for (const value of [undefined, () => 'x', new Date(TIME), NaN, 1n]) {
    const invalid = withNote();
    invalid.conversations[0].extension = value;
    assert.throws(() => validateArchive(invalid), ArchiveError);
  }
  const cyclic = withNote();
  cyclic.conversations[0].extension = cyclic;
  expectCode(() => validateArchive(cyclic), 'INVALID_STRUCTURE');
});
