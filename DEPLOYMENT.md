# 开发与部署

本文件供维护者使用，不会出现在应用界面中，也不包含真实用户数据。应用使用 Vite、React 和 JavaScript ES modules / JSX，构建为静态网站。

## 本地运行

使用 Node.js 22.12 或更新版本，在 `shiguang` 目录执行：

```sh
npm ci
npm run dev
```

打开终端显示的本地地址。其他命令：

```sh
npm test
npm run build
npm run preview
```

`npm test` 验证数据和保存逻辑，测试夹具均为虚构内容。`npm run build` 生成 `dist/`；`npm run preview` 用于本地检查构建结果。

本版不需要 API key、环境变量、后端服务或数据库。对话的导入、搜索、阅读和备份均在浏览器端完成，持久保存使用当前浏览器的本地存储。

## GitHub 仓库

**只将 `shiguang/` 目录作为项目内容上传。它的父目录含私人备份与其他工具，不属于本项目，不要一起上传。**

本目录的 `.gitignore` 只能保护本目录及其子目录，无法保护同级的私人备份。如果从父目录建立 Git 仓库，必须保留父目录中的白名单规则，只允许 `.gitignore` 和 `shiguang/` 进入提交；仍建议直接把 `shiguang/` 作为独立仓库根目录。

GitHub 网页上传文件、手工拖拽或压缩打包不会自动遵守 `.gitignore`。这些方式请只选择核对过的项目源文件，不要把整个工作区或私人文件夹一起上传。

- README 仅提供面向使用者的说明；设置帮助文案在 `src/content/help.mjs`。
- 源代码、测试、包清单和依赖锁文件应提交。
- 真实导入文件、导出备份、压缩包、环境变量、凭据、本地设计资料、截图、日志、依赖目录和构建产物均已加入忽略规则。
- 私人聊天只能在本地调试时使用。保留在项目外，或放在已忽略的 `private/`、`imports/`、`backups/` 中；不要复制进源码、静态资源、测试夹具或示例。
- 测试使用独立构造的虚构数据，不复制真实会话。
- 忽略规则无法识别随意改名的私人文件，也不会自动移除已被 Git 跟踪的文件。已经提交过的私人文件不会因补充忽略规则而自动从历史中消失，应先处理泄露内容再公开仓库。

提交或部署前，在项目根目录检查：

```sh
git status --short
git diff --cached --stat
git diff --cached
git ls-files
```

确认没有私人聊天、下载备份、个人截图、密钥或包含私人数据的调试日志。不要将检查时看到的私人内容粘贴到公开 issue、PR 或构建日志中。

## GitHub Pages

本项目可以部署为 GitHub Pages 静态网站。仓库根目录中的 `.github/workflows/deploy-pages.yml` 会自动安装依赖、运行测试、构建并发布网站。

首次部署按以下步骤操作：

1. 打开 GitHub 仓库的 **Settings → Pages**，在 **Build and deployment → Source** 中选择 **GitHub Actions**。完成这一步后，不需要再选择其他工作流模板。
2. 将项目源代码和 `.github/workflows/deploy-pages.yml` 提交并推送到仓库的 `main` 分支。工作流文件必须位于 GitHub 仓库根目录下的 `.github/workflows/`，不能放在额外的项目子目录中。
3. 打开仓库顶部的 **Actions**，点击 **Deploy to GitHub Pages**。打开最新一次运行，等待 `build` 和 `deploy` 都显示绿色勾号。首次运行通常需要几分钟。
4. 返回 **Settings → Pages**，点击页面显示的网站链接。当前仓库的默认地址是 [https://foroneice.github.io/shiguang-memories/](https://foroneice.github.io/shiguang-memories/)。以 GitHub 实际显示的地址为准。

如果工作流已经提交，但没有自动运行，可以在 **Actions → Deploy to GitHub Pages → Run workflow** 中选择 `main`，再点击 **Run workflow**。若出现红色失败标记，打开失败的任务和步骤查看原因；测试或构建未通过时，不会继续发布该版本。

后续每次推送到 `main` 都会自动更新网站，无需手工上传 `dist/`，也无需创建 `gh-pages` 分支。若改用其他分支部署，需要同时修改工作流的 `push.branches`，并在 **Settings → Environments → github-pages** 中核对允许部署的分支。

工作流使用 Node.js 22，依次执行 `npm ci`、`npm test` 和 Vite 构建。构建路径采用 `actions/configure-pages` 提供的 `base_path`，适配 `/shiguang-memories/` 这样的仓库子路径。最终仅将 `dist/` 交给 `actions/deploy-pages` 发布，源码、开发文档和 README 配图不会作为站点文件上传。

GitHub Pages 不使用 `vercel.json` 或 `.vercelignore`；Vercel 中配置的响应头也不会在 Pages 生效。发布范围由工作流上传的 `dist/` 目录限定，请不要改为上传仓库根目录。

从本地、Vercel 或其他域名迁移到 Pages 后，浏览器的来源地址（origin）发生变化，原站点保存的记录不会自动出现在新站点。请先在旧站点导出完整备份，再到新站点导入，以迁移对话、私人便笺和外观设置。上线后可使用应用自带的虚构示例检查阅读、搜索和主题切换。

选择托管用途时，请参阅 [GitHub Pages 使用限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)。

## Vercel

导入 GitHub 仓库，选择 Vite：

| 设置 | 值 |
| --- | --- |
| Root Directory | 独立仓库以本目录为根时填 `.`；仓库包含本子目录时填 `shiguang` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node.js Version | `22.x` 或受支持的更新版本 |
| Environment Variables | 本版无需配置 |

`.vercelignore` 为部署上传排除备份、研究资料与开发文档，不能代替 GitHub 的提交审查。发布范围由 Vite 构建和 Vercel 的 `dist` 输出目录限定，不能改成发布项目根目录或父目录。

开发服务器仅监听本机地址，文件访问范围限定为本项目；`publicDir: false` 禁用静态目录自动拷贝，源码映射未启用。不要为了读取本地备份而放宽文件访问范围：使用页面的文件选择入口即可。内部 `docs/`、`tests/` 不作为网页入口或静态资源发布。

部署后，用虚构示例或虚构 JSON 验证导入、搜索、主题切换、便笺保存、导出和完整备份恢复。不要把真实私人备份加入仓库来做线上验收。

站点地址或域名改变后，浏览器会将它视为另一个站点，原站点的本地内容不会自动迁移。变更地址前，提醒使用者导出完整备份，再到新地址导入。

## 数据原则

原始对话导出保持会话数组与原字段；私人便笺不追加到原始消息列表。完整备份包含格式标识、版本、导出时间、对话、便笺和外观设置。导入时先完整校验，再在一个浏览器存储事务中保存；失败时不得宣称保存成功。

`prepareFileImport` 在内存中处理全部所选文件，仅返回待确认的结果。界面确认后再调用 `saveArchive`，并且只在存储事务完成后提示保存成功。浏览器下载请求不等于文件已经落盘，导出后应提示用户到下载列表核对文件。

导入大小预检在读取文件和克隆历史之前执行。单文件超过 25 MiB 或一批超过 50 MiB 时先请用户确认，再以 `allowLargeFiles` 继续；这是运行资源提醒，不是硬上限或浏览器配额估计，不能阻止用户恢复自己较大的完整备份。继续后仍执行完整格式、冲突及事务校验。空间不足提示区分存储配额和运行资源异常，不透出底层错误文本；失败的导入候选可重试或返回原有记录，已保存内容保持不变。无法由 JavaScript 捕获的进程终止不能保证现场显示提示，原备份应始终保留。

同会话且资料一致的备份按消息标识合并：精确重复跳过，新增消息保留原有顺序后追加，同标识内容冲突则拒绝整个导入。展示层可以按时间排序，但不能改写用于导出的原始消息。多页面写入使用版本检查，旧页面不能静默覆盖新保存的数据。

导入数据不能作为代码、模板或指令执行。显示时使用安全文本或受控 Markdown 渲染，不自动加载历史中的远程附件。导出完整备份才能迁移便笺和外观；浏览器本地存储与持久存储授权都不能替代用户持有的备份文件。
