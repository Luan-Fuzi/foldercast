# 0005 · DSH 插件形态：工具提供方，shell 出去调 CLI

- 状态：已接受
- 日期：2026-10-04
- 决策者：项目作者

## 背景

foldercast 需要同时是**独立工具**（不装 DSH 也能用）和**DSH 插件**（装进 harness 后模型能直接调）。问题是怎么划分边界。

DSH 插件运行在 harness 的 Node 进程内（Cordis fiber 管理生命周期）。而 foldercast 的核心工作有完全不同的运行时需求：

| 工作需要 | 需求 |
|---|---|
| 目录分析与素材提取 | Python 3.11+ 与 `python-docx` / `python-pptx` / `PyMuPDF` |
| 视频渲染 | Node + React + **无头浏览器进程**（Remotion 逐帧截图） |
| 音频合成 | 网络调用 + `ffprobe` 子进程 |
| 编码 | `ffmpeg` 子进程 |

而 DSH 运行时是 Electron 内嵌的 Node（本机实测 `dsh --version` = `0.2.0-rc.2`）。

## 决策

**foldercast 的 DSH 插件是一个「工具提供方」（consumer）插件，通过子进程调用 foldercast CLI。**

```
DSH 进程
  └── foldercast 插件（TypeScript，轻）
        │  ctx.tools.register(defineTool(...))
        │  execute() → 起子进程
        ▼
      foldercast CLI（独立，Python + Node + ffmpeg）
        └── analyze / assets / narrate / render / voice
```

**插件进程内不做渲染、不做分析、不加载 Python 依赖。**

具体职责划分：

| 层 | 职责 |
|---|---|
| DSH 插件 | 工具声明、参数校验、子进程编排、进度输出、`exec.signal` 取消 |
| CLI | 全部实际工作 |

按官方[能力分层](../SYSTEM-DESIGN.md)术语，这是 **Consumer** 角色。foldercast 不需要拆出 Service Definition / Provider 三件套 —— 它没有可替换的实现方，只有一种执行方式。

## 理由

1. **渲染必须出进程。** Remotion 要起无头浏览器。在 harness 进程内起浏览器会污染其生命周期（fiber 卸载时要等浏览器退出），且 DSH 的启动失败策略里**未处理的 rejection 是致命的** —— 浏览器进程的任何异步错误都可能拖垮整个 harness。

2. **Python 依赖不能进 harness 进程。** `PyMuPDF` / `python-docx` 是 Python 生态的东西，DSH 插件是 TypeScript。跨语言只能走进程边界。

3. **独立工具是硬需求。** foldercast 首先是个能单独跑的 CLI（见 [ADR 0001](0001-separate-project.md)）。插件是它的**外壳**，而不是它的宿主。这个方向决定了依赖只能从插件指向 CLI，不能反过来。

4. **官方范式支持。** `dsh-tool-bash` 本身就是「在全新 shell 里跑命令」的工具插件。工具插件的职责是**声明与编排**，不是自己干活。

5. **失败隔离。** 渲染崩了只让这一次工具调用失败，不会让 harness 启动失败。

## 后果

**正面**：
- 插件极轻（无 Remotion / Python 依赖），安装快
- harness 稳定性不受渲染影响
- CLI 可独立测试、独立发布、独立使用
- 插件可用 `dsh plugin --profile web add foldercast` 安装，符合生态惯例

**负面**：
- **用户需要同时装 CLI 与插件**，或插件负责检测并引导安装
- 多一层进程边界，进度回传要靠 stdout 解析或结构化输出
- 取消（`exec.signal`）需要显式杀死子进程树 —— 这点 DSH 自己有前车之鉴（插件管理器要「停止整棵进程树」，因为生命周期脚本比启动它的进程活得久）

**缓解**：
- 插件在 `apply()` 或首次工具调用时检测 CLI 是否可用，给出明确的安装指引（而非晦涩的 `ENOENT`）
- 子进程用结构化输出（JSON lines）回传进度，不靠解析自然语言
- 杀死子进程树时用进程组，不杀单个 pid

## 备选方案

| 方案 | 否决理由 |
|---|---|
| 插件内含全部逻辑（Node + Remotion） | 仍解决不了 Python 依赖；且在 harness 进程内起浏览器违反启动失败策略 |
| 插件只做 UI（设置页配风格/TTS），渲染交给用户手动跑 | 模型无法直接触发，失去「一句话出片」的价值 |
| 拆成 Service Definition / Provider / Consumer 三包 | 过度设计。没有可替换的实现方，三件套的价值（换提供方）不存在 |
| MCP server 形态 | DSH 原生支持插件，没必要绕 MCP。且 MCP 丢掉了 Cordis 的生命周期与配置管理 |

## 参见

- [DSH 插件集成指南](../INTEGRATION-dsh-plugin.md) —— 具体的 manifest 与工具契约
- [ADR 0001 · 独立项目](0001-separate-project.md)
- [ADR 0003 · 用 Remotion 做渲染器](0003-remotion-as-renderer.md)
