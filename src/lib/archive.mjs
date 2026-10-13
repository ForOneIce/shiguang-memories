/**
 * Pure archive operations. Source conversations are JSON data, never instructions.
 * Every mutation returns a new archive, so a failed import cannot change saved data.
 */
export const BACKUP_FORMAT = 'shiguang.archive';
export const BACKUP_VERSION = 1;
export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'sakura',
  fontSize: 16,
  decorations: true,
});

export class ArchiveError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ArchiveError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ArchiveError(code, message);
}

function failResourceLimit() {
  fail(
    'IMPORT_RESOURCE_LIMIT',
    '浏览器这次整理记录需要更多运行空间，暂时还没能完成。原文件和之前保存的记录没有改变。可以先关闭不用的标签页，或换一台设备再试；请保留原文件，不需要修改其中的内容。',
  );
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(value, message) {
  if (!isRecord(value)) fail('INVALID_STRUCTURE', message);
}

function assertString(value, message, { nonempty = false } = {}) {
  if (typeof value !== 'string' || (nonempty && value.trim().length === 0)) {
    fail('INVALID_STRUCTURE', message);
  }
}

function assertKeys(record, allowed, required, message) {
  if (Object.keys(record).some((key) => !allowed.includes(key))
      || required.some((key) => !Object.hasOwn(record, key))) {
    fail('INVALID_STRUCTURE', message);
  }
}

// Reject values JSON would silently change or drop. Unknown source fields remain
// intact, including own keys named "__proto__"; they are never assigned to a target.
function cloneJson(value) {
  const active = new WeakSet();
  function inspect(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item))) {
        fail('UNSAFE_NUMBER', '文件中有无法完整保留的数字。请保留原文件，并尝试重新导出。');
      }
      return;
    }
    if (typeof item !== 'object' || active.has(item)) {
      fail('INVALID_STRUCTURE', '这份数据不是可保存的 JSON 格式，请使用导出的备份文件。');
    }
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) {
      fail('INVALID_STRUCTURE', '这份数据不是可保存的 JSON 格式，请使用导出的备份文件。');
    }
    if (Object.getOwnPropertySymbols(item).length > 0) {
      fail('INVALID_STRUCTURE', '这份数据包含无法保留的字段，请使用导出的备份文件。');
    }
    active.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const key of Object.keys(descriptors)) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        fail('INVALID_STRUCTURE', '这份数据包含无法保留的字段，请使用导出的备份文件。');
      }
      if (Array.isArray(item) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length)) {
        fail('INVALID_STRUCTURE', '这份数据包含无法保留的数组字段。');
      }
      inspect(descriptor.value);
    }
    if (Array.isArray(item) && Object.keys(item).length !== item.length) {
      fail('INVALID_STRUCTURE', '这份数据包含不完整的数组，请使用导出的备份文件。');
    }
    active.delete(item);
  }
  try {
    inspect(value);
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    if (error instanceof RangeError) failResourceLimit();
    fail('INVALID_STRUCTURE', '暂时无法读取这份数据。原文件没有改变，可以换一份备份再试。');
  }
}

function equalJson(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== typeof right) return false;
  if (typeof left !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
}

function equalConversationMetadata(left, right) {
  const leftKeys = Object.keys(left).filter((key) => key !== 'messages');
  const rightKeys = Object.keys(right).filter((key) => key !== 'messages');
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
}

function validateConversations(conversations) {
  if (!Array.isArray(conversations)) {
    fail('INVALID_STRUCTURE', '文件中没有找到对话列表，请选择导出的 JSON 备份。');
  }
  const conversationIds = new Set();
  const messageIds = new Set();
  conversations.forEach((conversation, conversationIndex) => {
    const position = `第 ${conversationIndex + 1} 组对话`;
    assertRecord(conversation, `${position}的格式不完整，请保留原文件并重新导出。`);
    for (const key of ['conversation_id', 'conversation_name', 'bot_id', 'bot_name', 'user_id']) {
      assertString(conversation[key], `${position}的必要信息不完整，请保留原文件并重新导出。`, {
        nonempty: key === 'conversation_id',
      });
    }
    if (conversationIds.has(conversation.conversation_id)) {
      fail('DUPLICATE_CONVERSATION', '文件中有重复的对话标识，暂未导入。原有记录没有改变。');
    }
    conversationIds.add(conversation.conversation_id);
    if (!Array.isArray(conversation.messages)) {
      fail('INVALID_STRUCTURE', `${position}没有完整的消息列表，请选择原始备份文件。`);
    }
    conversation.messages.forEach((message, messageIndex) => {
      const messagePosition = `${position}中的第 ${messageIndex + 1} 条记录`;
      assertRecord(message, `${messagePosition}的格式不完整，请选择原始备份文件。`);
      for (const key of ['message_id', 'conversation_id', 'bot_id', 'user_id', 'user_type',
        'content_type', 'show_content', 'create_time', 'update_time']) {
        assertString(message[key], `${messagePosition}的必要信息不完整，请选择原始备份文件。`, {
          nonempty: key === 'message_id' || key === 'conversation_id',
        });
      }
      if (Object.hasOwn(message, 'reply_id')) {
        assertString(message.reply_id, `${messagePosition}的回复标识格式不正确。`);
      }
      if (message.conversation_id !== conversation.conversation_id) {
        fail('INVALID_REFERENCE', `${messagePosition}的归属信息不一致，暂未导入。`);
      }
      if (messageIds.has(message.message_id)) {
        fail('DUPLICATE_MESSAGE', '文件中有重复的消息标识，暂未导入。原有记录没有改变。');
      }
      messageIds.add(message.message_id);
    });
  });
  return conversationIds;
}

function validatePreferences(preferences, { partial = false } = {}) {
  assertRecord(preferences, '外观设置的格式不完整，请选择完整备份文件。');
  const keys = ['theme', 'fontSize', 'decorations'];
  assertKeys(preferences, keys, partial ? [] : keys, '外观设置包含暂不支持的选项。');
  if (Object.hasOwn(preferences, 'theme') && !['sakura', 'purple', 'yellow'].includes(preferences.theme)) {
    fail('INVALID_PREFERENCES', '这份备份的外观主题暂不支持，请先更新工具。');
  }
  if (Object.hasOwn(preferences, 'fontSize')
      && (!Number.isInteger(preferences.fontSize) || preferences.fontSize < 14 || preferences.fontSize > 22)) {
    fail('INVALID_PREFERENCES', '字号需要在 14 到 22 之间。');
  }
  if (Object.hasOwn(preferences, 'decorations') && typeof preferences.decorations !== 'boolean') {
    fail('INVALID_PREFERENCES', '外观装饰设置的格式不正确。');
  }
}

function assertTimestamp(value, message) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail('INVALID_TIMESTAMP', message);
  }
}

function validateNotes(notes, conversationIds) {
  if (!Array.isArray(notes)) fail('INVALID_STRUCTURE', '便笺列表的格式不完整，请选择完整备份文件。');
  const noteIds = new Set();
  for (const note of notes) {
    assertRecord(note, '有一页便笺的格式不完整，暂未导入。');
    const keys = ['id', 'conversationId', 'body', 'createdAt', 'updatedAt'];
    assertKeys(note, keys, keys, '有一页便笺的格式不完整，暂未导入。');
    assertString(note.id, '有一页便笺缺少标识，暂未导入。', { nonempty: true });
    assertString(note.conversationId, '有一页便笺缺少对应的对话，暂未导入。', { nonempty: true });
    assertString(note.body, '有一页便笺的正文格式不正确，暂未导入。');
    assertTimestamp(note.createdAt, '有一页便笺的创建时间格式不正确，暂未导入。');
    assertTimestamp(note.updatedAt, '有一页便笺的修改时间格式不正确，暂未导入。');
    if (note.updatedAt < note.createdAt) {
      fail('INVALID_TIMESTAMP', '有一页便笺的修改时间早于创建时间，暂未导入。');
    }
    if (!conversationIds.has(note.conversationId)) {
      fail('INVALID_REFERENCE', '有一页便笺对应的对话不在备份中，请选择包含它的完整备份。');
    }
    if (noteIds.has(note.id)) fail('DUPLICATE_NOTE', '文件中有重复的便笺标识，暂未导入。');
    noteIds.add(note.id);
  }
}

/** Validates persisted state and returns an independent JSON clone. */
export function validateArchive(value) {
  const archive = cloneJson(value);
  assertRecord(archive, '本地记录的格式不完整，请使用完整备份恢复。');
  const keys = ['conversations', 'notes', 'preferences'];
  assertKeys(archive, keys, keys, '本地记录的格式不完整，请使用完整备份恢复。');
  const conversationIds = validateConversations(archive.conversations);
  validateNotes(archive.notes, conversationIds);
  validatePreferences(archive.preferences);
  return archive;
}

/** Creates empty state; supplied preferences may be a partial whitelist. */
export function createArchive({ preferences = {} } = {}) {
  const safePreferences = cloneJson(preferences);
  validatePreferences(safePreferences, { partial: true });
  return {
    conversations: [],
    notes: [],
    preferences: { ...DEFAULT_PREFERENCES, ...safePreferences },
  };
}

function parseSource(jsonText) {
  if (typeof jsonText !== 'string') fail('INVALID_JSON', '请选择 JSON 文件后再导入。');
  let source;
  try {
    // Some downloaded JSON files begin with a UTF-8 BOM.
    source = JSON.parse(jsonText.replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error instanceof RangeError) failResourceLimit();
    fail('INVALID_JSON', '暂时无法读取这份文件。请确认选择的是导出的 JSON 文件，原有记录没有改变。');
  }
  source = cloneJson(source);
  if (Array.isArray(source)) {
    validateConversations(source);
    return { kind: 'conversations', conversations: source, notes: [], preferences: null };
  }
  assertRecord(source, '文件中没有找到对话列表，请选择导出的 JSON 备份。');
  if (source.format !== BACKUP_FORMAT) {
    fail('UNSUPPORTED_FORMAT', '暂时不认识这份文件的格式，请选择原始对话 JSON 或本工具导出的完整备份。');
  }
  if (source.version !== BACKUP_VERSION) {
    fail('UNSUPPORTED_VERSION', '这份备份的版本暂不支持。请保留文件，并更新工具后再试。');
  }
  const keys = ['format', 'version', 'exportedAt', 'conversations', 'notes', 'preferences'];
  assertKeys(source, keys, keys, '完整备份的字段不完整或暂不支持，请保留文件并检查工具版本。');
  assertTimestamp(source.exportedAt, '完整备份的导出时间格式不正确，请选择原始备份文件。');
  const archive = validateArchive({
    conversations: source.conversations,
    notes: source.notes,
    preferences: source.preferences,
  });
  return { kind: 'backup', ...archive };
}

/**
 * Atomically merges JSON into state. Matching conversations retain their existing
 * message order and append new messages in source order. Identical messages are
 * idempotent; conflicting metadata or message contents reject the whole import.
 * Full backups restore their preferences; original conversation imports keep them.
 */
export function importArchive(jsonText, currentArchive = createArchive()) {
  const archive = validateArchive(currentArchive);
  const source = parseSource(jsonText);
  const existingConversations = new Map(archive.conversations.map((item) => [item.conversation_id, item]));
  const existingNotes = new Map(archive.notes.map((item) => [item.id, item]));
  const report = {
    kind: source.kind,
    addedConversations: 0,
    mergedConversations: 0,
    skippedConversations: 0,
    addedMessages: 0,
    skippedMessages: 0,
    addedNotes: 0,
    skippedNotes: 0,
    preferenceSource: source.kind === 'backup' ? 'backup' : 'current',
  };
  for (const conversation of source.conversations) {
    const existing = existingConversations.get(conversation.conversation_id);
    if (existing) {
      if (!equalConversationMetadata(existing, conversation)) {
        fail('CONVERSATION_CONFLICT', '这份文件与已有的一组对话资料不同，暂未合并。请先导出已有记录的完整备份，再单独查看另一份文件。');
      }
      const existingMessages = new Map(existing.messages.map((message) => [message.message_id, message]));
      let addedToConversation = 0;
      for (const message of conversation.messages) {
        const existingMessage = existingMessages.get(message.message_id);
        if (existingMessage) {
          if (!equalJson(existingMessage, message)) {
            fail('MESSAGE_CONFLICT', '这份文件中有一条消息与已有版本不同，暂未合并。请先分别保存完整备份，原有记录没有改变。');
          }
          report.skippedMessages += 1;
        } else {
          existing.messages.push(message);
          existingMessages.set(message.message_id, message);
          addedToConversation += 1;
          report.addedMessages += 1;
        }
      }
      if (addedToConversation > 0) report.mergedConversations += 1;
      else report.skippedConversations += 1;
    } else {
      archive.conversations.push(conversation);
      report.addedConversations += 1;
      report.addedMessages += conversation.messages.length;
    }
  }
  for (const note of source.notes) {
    const existing = existingNotes.get(note.id);
    if (existing) {
      if (!equalJson(existing, note)) {
        fail('NOTE_CONFLICT', '这份文件中有一页便笺与已有版本不同，暂未合并。两份内容都值得保留，请先分别保存完整备份。');
      }
      report.skippedNotes += 1;
    } else {
      archive.notes.push(note);
      report.addedNotes += 1;
    }
  }
  if (source.kind === 'backup') archive.preferences = source.preferences;
  return { archive: validateArchive(archive), report };
}

/** Exports only original conversations, with unknown fields and strings intact. */
export function exportConversations(archive) {
  return JSON.stringify(validateArchive(archive).conversations, null, 2);
}

/** Exports portable original conversations, separate private notes and appearance. */
export function exportFullBackup(archive, { exportedAt = new Date().toISOString() } = {}) {
  const valid = validateArchive(archive);
  assertTimestamp(exportedAt, '导出时间格式不正确，请稍后再试。');
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    conversations: valid.conversations,
    notes: valid.notes,
    preferences: valid.preferences,
  }, null, 2);
}

/** Notes never enter conversation.messages and never impersonate a role reply. */
export function addNote(archive, {
  conversationId,
  body,
  id = globalThis.crypto.randomUUID(),
  createdAt = new Date().toISOString(),
} = {}) {
  const next = validateArchive(archive);
  if (next.notes.some((note) => note.id === id)) {
    fail('DUPLICATE_NOTE', '便笺标识已存在，请为这一页使用新的标识。');
  }
  next.notes.push({ id, conversationId, body, createdAt, updatedAt: createdAt });
  return validateArchive(next);
}

export function updateNote(archive, id, body, { updatedAt = new Date().toISOString() } = {}) {
  const next = validateArchive(archive);
  const note = next.notes.find((item) => item.id === id);
  if (!note) fail('NOTE_NOT_FOUND', '没有找到这一页便笺，可以刷新记录后再试。');
  note.body = body;
  note.updatedAt = updatedAt;
  return validateArchive(next);
}

export function deleteNote(archive, id) {
  const next = validateArchive(archive);
  if (!next.notes.some((item) => item.id === id)) {
    fail('NOTE_NOT_FOUND', '没有找到这一页便笺，可以刷新记录后再试。');
  }
  next.notes = next.notes.filter((item) => item.id !== id);
  return next;
}

export function setPreferences(archive, changes) {
  const next = validateArchive(archive);
  const safeChanges = cloneJson(changes);
  validatePreferences(safeChanges, { partial: true });
  next.preferences = { ...next.preferences, ...safeChanges };
  return next;
}
