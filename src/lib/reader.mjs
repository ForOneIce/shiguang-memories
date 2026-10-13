/**
 * Local, read-only views of an archive. All returned text must be rendered as
 * text (for example React children), never passed to innerHTML or a Markdown
 * renderer. Attachment URLs are neither followed nor turned into links here.
 */
const MAX_DEPTH = 18;
const MAX_NODES = 4000;
const MAX_JSON_LENGTH = 1_000_000;
const MAX_STRUCTURED_TEXT_LENGTH = 200_000;
const TEXT_KEYS = ['title', 'subtitle', 'text', 'text_block', 'lyric', 'lyrics', 'description'];
const CONTAINER_KEYS = ['blocks', 'elements', 'children', 'parts', 'items', 'paragraphs', 'rich_text', 'body', 'data', 'response_for_model', 'widget_data'];

// Read only own data properties; inherited properties and getters are not data.
function own(object, key) {
  if (!object || typeof object !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function string(value) {
  return typeof value === 'string' ? value : '';
}

function timestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function structuredText(value, { metadata = false } = {}) {
  let nodes = 0;
  let length = 0;
  let truncated = false;
  const active = new WeakSet();

  function visit(item, depth, parseStrings = true) {
    if (depth > MAX_DEPTH || ++nodes > MAX_NODES || length >= MAX_STRUCTURED_TEXT_LENGTH) {
      truncated = true;
      return [];
    }
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (!trimmed) return [];
      // Exports may contain JSON encoded twice. Never show raw JSON on failure.
      if (parseStrings && /^[\[{\"]/.test(trimmed)) {
        if (item.length > MAX_JSON_LENGTH) {
          truncated = true;
          return [];
        }
        try {
          return visit(JSON.parse(item), depth + 1);
        } catch {
          return [];
        }
      }
      const available = MAX_STRUCTURED_TEXT_LENGTH - length;
      length += Math.min(item.length, available);
      if (item.length > available) truncated = true;
      return [item.slice(0, available)];
    }
    if (!item || typeof item !== 'object' || active.has(item)) return [];
    active.add(item);
    let chunks = [];
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length && nodes <= MAX_NODES; index += 1) {
        chunks.push(...visit(own(item, String(index)), depth + 1));
      }
      if (nodes > MAX_NODES) truncated = true;
    } else {
      // The newer representation often duplicates `content`; prefer one.
      const contentV2 = own(item, 'content_v2');
      let content = contentV2 === undefined ? [] : visit(contentV2, depth + 1);
      if (!content.length) content = visit(own(item, 'content'), depth + 1);
      const textKeys = metadata ? [...TEXT_KEYS, 'name'] : TEXT_KEYS;
      for (const key of textKeys) {
        chunks.push(...visit(own(item, key), depth + 1, key === 'text_block'));
      }
      chunks.push(...content);
      for (const key of CONTAINER_KEYS) {
        chunks.push(...visit(own(item, key), depth + 1));
      }
      // Music/podcast widgets have several generations of metadata wrappers.
      // Descend only objects/JSON containers, and expose the same text keys.
      // Never execute expressions, access inherited fields or follow URLs.
      if (metadata) {
        const excluded = new Set([...textKeys, ...CONTAINER_KEYS, 'content', 'content_v2', '__proto__', 'constructor', 'prototype']);
        for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
          if (excluded.has(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) continue;
          const child = descriptor.value;
          if ((child && typeof child === 'object') || (typeof child === 'string' && /^[\[{]/.test(child.trim()))) {
            chunks.push(...visit(child, depth + 1));
          }
          if (nodes > MAX_NODES) break;
        }
      }
    }
    active.delete(item);
    return chunks;
  }

  const chunks = visit(value, 0);
  const result = chunks.join('\n');
  return result && truncated ? `${result}\n（内容较长，此处展示部分文字；原始信息已保留）` : result;
}

function generatedSongText(content) {
  if (content.length > MAX_JSON_LENGTH) return '';
  let value = content;
  try {
    for (let index = 0; index < 3 && typeof value === 'string'; index += 1) value = JSON.parse(value);
  } catch {
    return '';
  }
  if (!value || typeof value !== 'object') return '';
  const songs = [];
  if (typeof own(value, 'title') === 'string' || typeof own(value, 'lyric') === 'string') songs.push(value);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value)).slice(0, MAX_NODES)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || !Object.hasOwn(descriptor, 'value')) continue;
    const item = descriptor.value;
    if (item && typeof item === 'object' && (typeof own(item, 'title') === 'string' || typeof own(item, 'lyric') === 'string')) {
      // Keep the song title/lyrics; captions and playback metadata duplicate it.
      songs.push({ title: own(item, 'title'), lyric: own(item, 'lyric') });
    }
  }
  return structuredText(songs);
}

/** Text messages are unchanged. Structured attachments expose only known text. */
export function getMessageText(message) {
  const type = string(own(message, 'content_type')).toLowerCase();
  const content = string(own(message, 'show_content'));
  if (type === 'text') return content;
  if (['block', 'card', 'widget'].includes(type)) {
    return structuredText(content, { metadata: type === 'widget' }) || '这条内容暂时无法展示，原始信息已保留。';
  }
  if (type === 'lyrics_to_songs_music') {
    return generatedSongText(content) || '音乐内容暂时无法展示，原始信息已保留。';
  }
  const labels = { image: '图片', audio: '语音', voice: '语音', video: '视频', file: '文件' };
  const label = Object.hasOwn(labels, type) ? labels[type] : '附件';
  return `${label}内容暂时无法展示，原始信息已保留。`;
}

function conversationsArray(conversations) {
  return Array.isArray(conversations) ? conversations : [];
}

function messagesArray(conversation) {
  const messages = own(conversation, 'messages');
  return Array.isArray(messages) ? messages : [];
}

function compareMessages(left, right) {
  const leftTime = timestamp(own(left, 'create_time'));
  const rightTime = timestamp(own(right, 'create_time'));
  if (leftTime === null) return rightTime === null ? 0 : 1;
  if (rightTime === null) return -1;
  return leftTime - rightTime;
}

function enrich(message, conversation) {
  // Object.fromEntries creates own data keys, including a harmless __proto__.
  const copy = Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(message || {}))
    .filter(([, descriptor]) => descriptor.enumerable && Object.hasOwn(descriptor, 'value'))
    .map(([key, descriptor]) => [key, descriptor.value]));
  return {
    ...copy,
    conversationId: string(own(conversation, 'conversation_id')),
    roleId: string(own(conversation, 'bot_id')),
    roleName: string(own(conversation, 'bot_name')) || '未命名角色',
    text: getMessageText(message),
  };
}

/**
 * Group by bot_id, preserving first-seen role and conversation order.
 * firstTime/lastTime are original valid message timestamps, or '' if unknown.
 * conversations contains the original read-only conversation references.
 */
export function getRoles(conversations) {
  const roles = new Map();
  for (const conversation of conversationsArray(conversations)) {
    const id = string(own(conversation, 'bot_id'));
    if (!roles.has(id)) {
      roles.set(id, {
        id, name: string(own(conversation, 'bot_name')) || '未命名角色',
        conversations: [], messageCount: 0, lastTime: '', firstTime: '',
      });
    }
    const role = roles.get(id);
    role.conversations.push(conversation);
    const messages = messagesArray(conversation);
    role.messageCount += messages.length;
    for (const message of messages) {
      const value = own(message, 'create_time');
      const time = timestamp(value);
      if (time === null) continue;
      if (!role.firstTime || time < timestamp(role.firstTime)) role.firstTime = value;
      if (!role.lastTime || time > timestamp(role.lastTime)) role.lastTime = value;
    }
  }
  return [...roles.values()];
}

/** Ascending creation time; ties and unknown times retain archive order. */
export function getRoleMessages(conversations, botId) {
  return conversationsArray(conversations)
    .filter((conversation) => string(own(conversation, 'bot_id')) === botId)
    .flatMap((conversation) => messagesArray(conversation).map((message) => enrich(message, conversation)))
    .sort(compareMessages);
}

/** Browser-local calendar day, including timezone/DST, or '' for unknown time. */
export function getLocalDateKey(value) {
  const time = timestamp(value);
  if (time === null) return '';
  const date = new Date(time);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * Literal, case-insensitive substring search with optional role and inclusive
 * local-calendar date filters. Invalid/reversed date ranges yield no matches.
 * Unknown message dates remain visible only when no date filter is requested.
 */
export function searchMessages(conversations, { query = '', roleId = '', from = '', to = '' } = {}) {
  if ((from && !validDateKey(from)) || (to && !validDateKey(to)) || (from && to && from > to)) return [];
  const needle = string(query).toLowerCase();
  const dateFilter = Boolean(from || to);
  return conversationsArray(conversations)
    .filter((conversation) => !roleId || string(own(conversation, 'bot_id')) === roleId)
    .flatMap((conversation) => messagesArray(conversation).map((message) => enrich(message, conversation)))
    .filter((message) => {
      if (!message.text.toLowerCase().includes(needle)) return false;
      if (!dateFilter) return true;
      const date = getLocalDateKey(message.create_time);
      return Boolean(date) && (!from || date >= from) && (!to || date <= to);
    })
    .sort(compareMessages);
}
