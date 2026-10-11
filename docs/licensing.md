# 许可与第三方组件

foldercast 的[包元数据](../packages/plugin/package.json)声明使用 MIT 许可。

## Remotion

出片这一步用 [Remotion](https://www.remotion.dev/) 渲染画面。它**不是纯开源**，请按
自家情况判断：

| 你的情况 | 适用档位 | 价格（2026-10-11 复核） |
|---|---|---|
| 个人，或 ≤3 人的公司 | Free License | $0，含无限商业使用 |
| 需要 Company License，进行少量手工视频创作 | Creators | $25/月/座 |
| 需要 Company License，进行批量渲染或开发自动化视频产品 | Automators | **$0.01/次渲染，$100/月起** |

**foldercast 本身按 Free License 使用**（个人项目）。是否需要 Company License 取决于
使用者是否符合免费许可条件；嵌入产品本身不意味着一律需要付费。免费许可的允许用途与
限制见[官方许可](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)，
收费档位见[官方定价](https://www.remotion.dev/docs/license/pricing)。遥测行为受 Remotion
版本与配置影响，见[遥测说明](https://www.remotion.dev/docs/telemetry)。

出片还需要浏览器（Chrome / Chromium / Edge）：**我们不分发它**，用系统已装的，
或让 Remotion 下载。


## foldercast 的 MIT 许可

[LICENSE](../LICENSE) 的版权主体为 `Luan_Fuzi`。MIT 适用于本项目自有代码和文档，允许使用、修改和分发，分发副本或重要部分时须保留版权与许可声明。依赖仍使用各自许可，不能把整个安装目录标为 MIT。

完整的[第三方说明](../THIRD_PARTY_NOTICES.md)随 npm 包分发；[生产依赖清单](dependency-licenses.json)记录本机锁定安装中检查到的组件。普通 MIT、ISC、BSD、Apache 组件主要要求保留相应声明；Apache 的 NOTICE、PDF.js 的字体和 CMap 声明也需按实际分发内容保留。

## MPL 与 GPL 组件

可选的 LibreOffice kit，以及 Remotion 依赖的 Mediabunny / 编码器包含 MPL-2.0 组件。MPL 的源码义务针对覆盖文件和对应可执行形式，不要求独立的整个 foldercast 项目改用 MPL。本项目没有修改这些组件；重新分发其二进制时仍需保留许可，并提供相应源码获取方式。LibreOffice 原生包自带 `licenses/` 与 `sources/`，打包安装器时应一起保留。[Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)

本机安装的 Remotion 4.0.532 macOS ARM64 compositor 包含 FFmpeg / ffprobe，其 FFmpeg 自报 GPL v2 或更高版本，并启用 GPL 编码器。这些二进制没有放入 foldercast 的 `.tgz`，但会随依赖安装。不能据此说“项目没有 GPL 组件”。独立程序调用本身也不能证明调用者代码必须改用 GPL；若做一体安装器、容器或重新分发依赖，应按实际二进制构建核对声明与对应源码义务。[Remotion acknowledgements](https://www.remotion.dev/docs/acknowledgements) · [FFmpeg legal](https://ffmpeg.org/legal.html)

本次结论基于锁文件、实际安装包的许可材料和上述官方条款。未来更新依赖或增加第三方代码、字体和模板时，应重新核查对应部分。
