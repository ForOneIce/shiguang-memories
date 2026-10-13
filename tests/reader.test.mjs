import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMessageText, getRoles, getRoleMessages, getLocalDateKey, searchMessages,
} from '../src/lib/reader.mjs';

function message(id, content, time = '2025-04-03T10:00:00.000Z', contentType = 'text') {
  return { message_id: id, show_content: content, create_time: time, content_type: contentType, user_type: 'bot' };
}
function conversation(id, roleId, name, messages) {
  return { conversation_id: id, bot_id: roleId, bot_name: name, messages };
}
function localTimestamp(year, month, day, hours = 0, minutes = 0, seconds = 0, milliseconds = 0) {
  return new Date(year, month - 1, day, hours, minutes, seconds, milliseconds).toISOString();
}

test('plain text remains literal, including malicious markup and JSON-looking text', () => {
  const html = '<img src="https://example.invalid/a" onerror="globalThis.compromised=true"><script>throw 1</script>';
  assert.equal(getMessageText(message('a', html)), html);
  assert.equal(getMessageText(message('b', '{"text":"literal text"}')), '{"text":"literal text"}');
  assert.equal(globalThis.compromised, undefined);
});

test('block handles double-encoded content and nested text_block', () => {
  const payload = JSON.stringify({
    content: JSON.stringify({ content: [{ text_block: { text: '今天也有新的风景。' } }, { text: '慢慢走就好。' }] }),
  });
  assert.equal(getMessageText(message('a', payload, '', 'block')), '今天也有新的风景。\n慢慢走就好。');
  const twice = JSON.stringify(JSON.stringify({ content_v2: [{ text: '周末去看花吧。' }] }));
  assert.equal(getMessageText(message('b', twice, '', 'block')), '周末去看花吧。');
});

test('prefers content_v2 to duplicated old content and falls back if unrecognized', () => {
  const payload = JSON.stringify({ content: '旧文字', content_v2: [{ text: '新文字' }] });
  assert.equal(getMessageText(message('a', payload, '', 'block')), '新文字');
  const fallback = JSON.stringify({ content: '仍可阅读', content_v2: { url: 'https://example.invalid' } });
  assert.equal(getMessageText(message('b', fallback, '', 'block')), '仍可阅读');
});

test('card response text is readable without rendering its remote template', () => {
  const payload = JSON.stringify({
    template_url: 'https://example.invalid/template',
    data: JSON.stringify({ elements: { 'fictional-template-id': { props: { content: { value: 'do not execute this' } } } } }),
    response_for_model: JSON.stringify({ data: [{ title: '虚构的参考资料', url: 'https://example.invalid/private' }] }),
  });
  assert.equal(getMessageText(message('a', payload, '', 'card')), '虚构的参考资料');
});

test('nested music and podcast widget metadata yields only text fields', () => {
  const payload = JSON.stringify({ widget_data: JSON.stringify({ data: JSON.stringify({
    songListData: [{ entities: [{ song_metadata: { name: '晴天练习曲', performers: [{ name: '虚构歌手' }], url: 'https://example.invalid/music' } }] }],
    episodeList: { episodes: [{ episode_metadata: { title: '散步时的小故事', id: 'fictional-id', audio: 'https://example.invalid/audio' } }] },
  }) }) });
  assert.equal(getMessageText(message('a', payload, '', 'widget')), '晴天练习曲\n虚构歌手\n散步时的小故事');
});

test('generated music exposes title and lyrics without playback metadata or duplicate captions', () => {
  const payload = JSON.stringify({
    task_nums: 1,
    'fictional-dynamic-key': { title: '阳台上的云', lyric: '[第一段]\n今天的风轻轻吹。', video_model: JSON.stringify({ title: 'hidden' }), captions_result: { utterances: [{ text: 'duplicate lyrics' }] } },
  });
  assert.equal(getMessageText(message('a', payload, '', 'lyrics_to_songs_music')), '阳台上的云\n[第一段]\n今天的风轻轻吹。');
  assert.match(getMessageText(message('b', '{broken', '', 'lyrics_to_songs_music')), /音乐内容暂时无法展示/);
});

test('cards/widgets extract actual strings but ignore URLs, unknown properties and raw JSON', () => {
  const payload = JSON.stringify({ title: '一起听的歌', data: { lyrics: '这是虚构的歌词' }, url: 'https://example.invalid', command: 'run()', count: 2 });
  assert.equal(getMessageText(message('a', payload, '', 'card')), '一起听的歌\n这是虚构的歌词');
  assert.equal(getMessageText(message('a', '{"text":', '', 'widget')), '这条内容暂时无法展示，原始信息已保留。');
  assert.equal(getMessageText(message('a', '{"unknown":"secret"}', '', 'card')), '这条内容暂时无法展示，原始信息已保留。');
  assert.match(getMessageText(message('a', 'https://example.invalid/image.jpg', '', 'image')), /^图片内容/);
  assert.match(getMessageText(message('a', 'secret', '', '__proto__')), /^附件内容/);
  assert.equal(getMessageText(message('a', JSON.stringify({ text: '[微笑] 今天很好。' }), '', 'block')), '[微笑] 今天很好。');
});

test('does not follow inherited fields, execute accessors or modify prototypes', () => {
  const payload = '{"__proto__":{"text":"hidden","polluted":true},"constructor":{"text":"hidden"},"text":"可见"}';
  assert.equal(getMessageText(message('a', payload, '', 'card')), '可见');
  assert.equal({}.polluted, undefined);
  const guarded = { content_type: 'text', get show_content() { throw new Error('must not run'); } };
  assert.equal(getMessageText(guarded), '');
  assert.equal(getMessageText(Object.create({ content_type: 'text', show_content: 'inherited' })).includes('inherited'), false);
});

test('structured text is bounded and handles unknown or malformed message data', () => {
  let nested = { text: 'too deep' };
  for (let index = 0; index < 20; index += 1) nested = { content: nested };
  assert.match(getMessageText(message('a', JSON.stringify(nested), '', 'block')), /暂时无法展示/);
  const long = getMessageText(message('b', JSON.stringify({ text: 'a'.repeat(300_000) }), '', 'block'));
  assert.ok(long.length < 201_000);
  assert.match(long, /展示部分文字/);
  assert.match(getMessageText(null), /原始信息已保留/);
});

test('groups same role across conversations without conflating equal names', () => {
  const source = [
    conversation('a', 'role-1', '晴天', [message('m1', 'one', '2025-04-03T10:00:00Z'), message('m2', 'two', 'unknown')]),
    conversation('b', 'role-2', '晴天', []),
    conversation('c', 'role-1', '晴天', [message('m3', 'three', '2025-04-01T10:00:00Z')]),
  ];
  const roles = getRoles(source);
  assert.equal(roles.length, 2);
  assert.equal(roles[0].messageCount, 3);
  assert.deepEqual(roles[0].conversations, [source[0], source[2]]);
  assert.equal(roles[0].firstTime, '2025-04-01T10:00:00Z');
  assert.equal(roles[0].lastTime, '2025-04-03T10:00:00Z');
  assert.equal(roles[1].firstTime, '');
  assert.equal(roles[1].lastTime, '');
});

test('time ordering compares actual instants and stably places unknown dates last', () => {
  const source = [
    conversation('a', 'r', '甲', [message('u1', 'unknown', ''), message('later', 'one', '2025-04-01T10:00:00Z'), message('tie1', 'tie', '2025-04-01T02:00:00Z')]),
    conversation('b', 'r', '甲', [message('early', 'two', '2025-04-01T09:00:00+08:00'), message('tie2', 'tie', '2025-04-01T02:00:00Z'), message('u2', 'unknown', 'oops')]),
  ];
  const before = structuredClone(source);
  const result = getRoleMessages(source, 'r');
  assert.deepEqual(result.map((item) => item.message_id), ['early', 'tie1', 'tie2', 'later', 'u1', 'u2']);
  assert.equal(result[0].conversationId, 'b');
  assert.equal(result[0].roleId, 'r');
  assert.equal(result[0].roleName, '甲');
  assert.equal(result[0].text, 'two');
  assert.notEqual(result[0], source[1].messages[0]);
  assert.deepEqual(source, before);
  assert.deepEqual(getRoleMessages(source, 'absent'), []);
});

test('local date keys use the browser calendar rather than UTC date boundaries', () => {
  assert.equal(getLocalDateKey(localTimestamp(2025, 4, 3, 0, 5)), '2025-04-03');
  assert.equal(getLocalDateKey(localTimestamp(2025, 4, 3, 23, 59)), '2025-04-03');
  for (const invalid of ['', 'unknown', null, 0, undefined]) assert.equal(getLocalDateKey(invalid), '');
});

test('search is literal, case-insensitive and combines role, date, and text filters', () => {
  const source = [
    conversation('a', 'r1', '甲', [
      message('before', 'HAPPY [day]', localTimestamp(2025, 4, 2, 23, 59, 59, 999)),
      message('first', 'Happy [day]', localTimestamp(2025, 4, 3)),
      message('last', 'HAPPY [day]', localTimestamp(2025, 4, 3, 23, 59, 59, 999)),
      message('after', 'happy [day]', localTimestamp(2025, 4, 4)),
      message('unknown', 'Happy [day]', 'unknown'),
      message('nomatch', 'happy day', localTimestamp(2025, 4, 3)),
    ]),
    conversation('b', 'r2', '乙', [message('other', 'happy [day]', localTimestamp(2025, 4, 3))]),
  ];
  const before = structuredClone(source);
  assert.deepEqual(searchMessages(source, { query: 'happy [day]', roleId: 'r1', from: '2025-04-03', to: '2025-04-03' }).map((item) => item.message_id), ['first', 'last']);
  assert.equal(searchMessages(source, { query: '[day]' }).length, 6);
  assert.equal(searchMessages(source, { query: '.*' }).length, 0);
  assert.equal(searchMessages(source, { roleId: 'r1', from: '2025-04-04' }).length, 1);
  assert.equal(searchMessages(source, { roleId: 'r1', to: '2025-04-02' }).length, 1);
  assert.deepEqual(source, before);
});

test('date validation includes leap years and rejects invalid/reversed date ranges', () => {
  const source = [conversation('a', 'r', '甲', [message('m', 'Hello', localTimestamp(2024, 2, 29))])];
  assert.equal(searchMessages(source, { from: '2024-02-29', to: '2024-02-29' }).length, 1);
  for (const options of [{ from: '2025-02-29' }, { to: '2024-02-30' }, { from: 'bad' }, { from: '2024-03-01', to: '2024-02-01' }]) {
    assert.deepEqual(searchMessages(source, options), []);
  }
  assert.deepEqual(getRoles(null), []);
  assert.deepEqual(searchMessages(null), []);
});
