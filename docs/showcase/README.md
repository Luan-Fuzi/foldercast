# foldercast 解析自己

这是基于 foldercast 0.3.0 的仓库导览，面向第一次接触项目的读者。主线是用途、模型与程序的职责、创作流程、核心代码、输出风格和使用边界。没有逐个讲解测试、历史发布或全部配置字段。

## 查看产物

- [HTML 导览页](foldercast.html)：下载后用浏览器打开。本例无外部图片，页面可以单文件转发。
- [MP4 视频](foldercast.mp4)：实际渲染，配音与时长信息见[产物清单](manifest.json)。
- [封面](cover.png)、[工作流画面](workflow.png)、[职责画面](roles.png)：从实际视频截取。
- [事实库](digest.json)、[讲稿](script.json)、[独立评审](review.md)：生成时的创作输入与核查记录。

这些文件是展示快照，源代码变化不会自动刷新它们。评审 revision 属于生成时的工作目录；不能把快照报告当作之后修改的输入的有效回执。哈希与输出规格记录在 `manifest.json`，本地配音缓存和中间素材保留在被忽略的 `.foldercast/`。

本次视频为 1920 × 1080、30 fps，实际时长约 2 分 19 秒；使用 Edge 中文音色。内容经过独立评审，视频已完成全片解码检查与逐场截图目检，未进行人工听感验收。HTML 于 0.3.1-rc.1 使用原讲稿快照重做排版；320、390、768、1440px 已实测无整页横向溢出，代码区块独立滚动，导航锚点完整。视频与原内容评审保持 0.3.0 的记录。

## 在自己的检出中重做

先安装开发依赖与所需外部工具，见[开发说明](../development.md)。在仓库根目录复制创作输入，并更新绝对源目录路径：

```bash
mkdir -p .foldercast
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
for (const name of ['script', 'digest']) {
  const doc = JSON.parse(readFileSync(`docs/showcase/${name}.json`, 'utf8'));
  doc.source.root = process.cwd();
  writeFileSync(`.foldercast/${name}.json`, JSON.stringify(doc, null, 2) + '\n');
}
JS
pnpm render . --check
```

重新核对事实库中的文件计数和证据，必要时调整讲稿，按[评审判据](../../packages/plugin/scripts/references/review.md)完成独立评审并通过 `foldercast_cast` 记录当前版本回执。随后正式生成：

```bash
pnpm page . --approved
pnpm voice . --provider edge --approved
pnpm render . --approved
```

正式产物位于 `.foldercast/out/`。要调画面可省略 `--approved` 生成草稿；不要直接复用展示快照的回执。更新仓库示例时，只复制交付文件，更新截图、评审与清单；不提交逐场音频、缓存或渲染临时目录。
