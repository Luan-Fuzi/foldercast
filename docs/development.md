# 开发与命令行

本页面向仓库开发者。DSH 安装、设置和 MiMo 密钥见[插件使用说明](../packages/plugin/README.md)。

## 环境与依赖

仓库使用 pnpm，版本由根目录 `packageManager` 固定。先安装 Node 和项目依赖；浏览器、音频工具与 Office / PDF 转换工具按阶段需要探测。讲稿校验不需要浏览器或配音密钥。

| 依赖 | 什么时候需要 | 安装或配置 |
|---|---|---|
| Node `^22.19.0 \|\| >=24.0.0` | 运行仓库的 TypeScript 与安装包的 JS | macOS 可用 Homebrew；其他平台按对应安装方式配置 |
| Chrome / Chromium / Edge | 视频与静帧渲染 | 使用系统浏览器，或 `npx remotion browser ensure`；也可用 `FOLDERCAST_BROWSER=<路径>` 指定 |
| `ffmpeg` / `ffprobe` | 配音转换、实测时长和视频封面；非 macOS 平台也用于图片缩放 | macOS：`brew install ffmpeg`；Windows：`winget install --id Gyan.FFmpeg`；Linux：发行版包管理器 |
| `@deepseek-ai/libreoffice-kit` | Office / PDF 的文本与逐页图处理 | 随包作为 optionalDependency 安装；安装失败只影响相关素材处理 |
| `sips` | macOS 图片缩放 | 系统自带；其他平台回退到 ffmpeg |

配音需要网络。Edge 默认免密钥，MiMo 需要 `MIMO_API_KEY`。缺浏览器只影响渲染；渲染脚本不自动下载浏览器，退出码为 3，并给出配置办法。

## 独立运行阶段

先由 Agent 或人工编写 `<目录>/.foldercast/script.json`。命令行入口执行既定讲稿，不自动探索目录或创作内容：

```bash
pnpm render <目录> --check       # 校验讲稿与计划，不渲染
pnpm page <目录>                 # HTML 导览页
pnpm voice <目录>                # 场景音频、实测时长与完整音轨
pnpm render <目录>               # MP4；有效配音存在时带旁白
pnpm render <目录> --still 3.5   # 3.5 秒处的静帧
pnpm text <文件>                 # Office / PDF 文本 → Markdown，输出到 stdout
```

CLI 默认生成工作草稿。正式产出加 `--approved`，要求与当前输入匹配的评审回执；`--check` 不要求回执。独立评审通过后，通过 `foldercast_cast` 的 `reviewRevision` 记录回执。程序核对版本与报告哈希，不解析报告结论。[工作流与判据](../packages/plugin/src/skill.ts)

```bash
pnpm page <目录> --style 编辑设计风格
pnpm render <目录> --style 科技风格
pnpm voice <目录> --provider edge
pnpm page <目录> --approved
```

HTML 与视频共用场景。页面可以单独生成；图片超过内联预算时保留相对路径，转发需附素材并保留对应位置。Office / PDF 页图与视频封面的相对路径指向准备产物。

## 版本、时长与缓存

- `digest.json` 是事实库，只供创作与评审使用；`script.json` 是自足的渲染输入。契约见 [schema](specs/script.schema.json)。
- revision 对讲稿、digest 与直接引用文件计算内容哈希；引用目录使用文件名、大小与修改时间，digest 的总文件数抽查也参与。它不覆盖全部源文件正文或软件版本。
- `artifacts.json` 记录产物输入版本、参数、依赖与输出哈希。current 表示匹配登记时的输入和参数，不证明内容正确或适合新设置。输入变化不会自动重做产物。
- 配音后，时长来自 `ffprobe` 实测；节拍对齐字幕。换音色会改变音轨、时长与节拍时序，字数不决定实际时长。
- `audio/cache.json` 按每场旁白、provider、音色、风格、格式等合成输入及音频哈希复用，支持断点续跑。只改画面不需要重配；改讲稿的 voice 配置需重跑 voice，但请求相同的场景可复用。
- 渲染拒绝过期、缺少版本记录或完整音轨不符合当前讲稿的 durations。旧评审需重新绑定当前版本；无缓存记录的旧音频首次重跑会重配。

同一份讲稿的逐帧视觉一致性判据为每帧 PSNR ≥ 45dB，允许字形抗锯齿噪声；不是文件字节相等。默认渲染并发为 1，CLI 可显式调大。设置中的创作分钟数用于模型规划，不截断音轨。[可信执行决策](decisions/0008-trusted-execution.md)

中断渲染后可能留下 `puppeteer_dev_chrome_profile-*` 后台 Chrome。需要清理时，先确认对应进程属于中断的渲染，再运行 `pkill -f puppeteer_dev_chrome_profile`。

## 代码位置

| 路径 | 职责 |
|---|---|
| `packages/plugin/src/` | 工具注册、skill、设置与编排 |
| `packages/plugin/scripts/contracts/` | 讲稿、时长、偏好、版本与共享类型 |
| `packages/plugin/scripts/assets/` | 文本提取、按需素材转换与缓存 |
| `packages/plugin/scripts/scenecard/` | HTML 与视频共用的场景卡 |
| `packages/plugin/scripts/page/` | HTML 导览页 |
| `packages/plugin/scripts/voice/` | 配音与音频时长 |
| `packages/plugin/scripts/renderer/` | TypeScript + Remotion 渲染 |
| `packages/plugin/scripts/references/` | 创作与独立评审参考 |
| `docs/decisions/` | 设计决策 |
| `docs/showcase/` | 仓库自解析的交付快照 |

全部代码使用 TypeScript。创作编排由 DSH 主 Agent 完成，程序负责检查与执行阶段。

## 验证与分发

提交前完成类型检查、文档与契约检查、测试：

```bash
pnpm install
pnpm typecheck
pnpm run check
pnpm test
```

渲染测试使用无头浏览器并串行执行。CI 核查契约与 mock；真实配音、听感和画面目检在本地验证，结论记录到 `docs/`。

发布前运行：

```bash
pnpm --filter dsh-foldercast prepack
```

`prepack` 同步 schema、编译 JS 与类型、构建设置页，生成不入库的 `lib/` 与 `schemas/`。Node 不允许在 `node_modules` 中剥离 TypeScript，分发入口必须是 JS。修改 `packages/plugin/src/` 后需要重启 DSH，入口不热加载。
