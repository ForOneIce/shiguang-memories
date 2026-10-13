import { createArchive } from '../lib/archive.mjs';

// Entirely authored fictional examples. Never replace these with imported records.
const demoRoles = [
  { id: 'forest', name: '林间', messages: [
    ['user', '2026-04-18T09:42:00Z', '今天路过那家面包店，终于买到了刚出炉的可颂。'],
    ['bot', '2026-04-18T09:43:00Z', '那今天的散步，还多了一份香香脆脆的小收获。'],
    ['user', '2026-04-18T09:44:00Z', '对！下次想再试试它的蓝莓吐司。'],
    ['bot', '2026-04-18T09:45:00Z', '可以列一张小小的面包清单。每次路过，就挑一种没尝过的。'],
    ['user', '2026-04-21T10:05:00Z', '蓝莓吐司也很好吃，今天还带了一本书去公园。'],
    ['bot', '2026-04-21T10:06:00Z', '有面包、有树荫，还有一本书，听起来是个舒服的下午。你看到哪一页啦？'],
    ['user', '2026-04-21T10:08:00Z', '没看几页，一直在看树叶透下来的光。'],
    ['bot', '2026-04-21T10:09:00Z', '那也很好呀。书签停一会儿，日光刚好翻过了树叶。'],
  ] },
  { id: 'sunny', name: '晴禾', messages: [
    ['user', '2026-04-17T03:10:00Z', '窗台上的小植物，今天终于长出了新叶子。'],
    ['bot', '2026-04-17T03:11:00Z', '新叶子刚展开的时候，颜色是不是特别浅？'],
    ['user', '2026-04-17T03:12:00Z', '是的，浅浅的绿色，很可爱。'],
    ['bot', '2026-04-17T03:13:00Z', '像给春天添了一枚小书签。拍一张照片，过几天再看看它长了多少。'],
    ['user', '2026-04-22T04:00:00Z', '今天给花盆换了个位置，下午能晒到一点太阳。'],
    ['bot', '2026-04-22T04:02:00Z', '那就观察几天，看它喜不喜欢这个新位置。照顾小植物，也是在慢慢认识它。'],
  ] },
  { id: 'summer', name: '夏芽', messages: [
    ['user', '2026-04-19T10:20:00Z', '傍晚出门走走，看到了粉橘色的日落。'],
    ['bot', '2026-04-19T10:21:00Z', '听起来很漂亮。你有把那个颜色拍下来吗？'],
    ['user', '2026-04-19T10:22:00Z', '有呀，还拍到了刚亮起来的路灯。'],
    ['bot', '2026-04-19T10:23:00Z', '一半是落日，一半是灯光，正好把傍晚装进一张照片里。'],
    ['user', '2026-04-23T09:50:00Z', '今天云很多，想等一个有晚霞的晴天。'],
    ['bot', '2026-04-23T09:51:00Z', '先把散步留给今天，把晚霞留给下一次遇见。阴天也有自己的颜色。'],
  ] },
];

export function createDemoArchive() {
  const archive = createArchive();
  archive.conversations = demoRoles.map(role => {
    const conversationId = 'demo-conversation-' + role.id;
    return {
      conversation_id: conversationId,
      conversation_name: '',
      bot_id: 'demo-role-' + role.id,
      bot_name: role.name,
      user_id: 'demo-user',
      messages: role.messages.map(([userType, timestamp, text], index) => ({
        message_id: `demo-${role.id}-${index}`,
        conversation_id: conversationId,
        bot_id: 'demo-role-' + role.id,
        user_id: 'demo-user',
        user_type: userType,
        content_type: 'text',
        show_content: text,
        create_time: timestamp,
        update_time: timestamp,
      })),
    };
  });
  return archive;
}
