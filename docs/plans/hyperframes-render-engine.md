# 日后计划 · 渲染引擎迁移：Remotion → HyperFrames（未启动）

状态：**展望，未定案，未启动**。本文只记录选项、动机与触发条件；做不做、什么时候做，
到时候重新评估再定。关联：0005（与 HyperFrames 的取舍对照）。

## 是什么

[HyperFrames](https://github.com/heygen-com/hyperframes)（HeyGen 开源，Apache 2.0）：
把 HTML + CSS + 可 seek 动画渲染成确定性 MP4。headless Chrome 逐帧 seek + FFmpeg
编码，同一输入同一输出；无构建步骤；官方提供 `remotion-to-hyperframes` 迁移 skill。

## 为什么值得考虑

1. **许可**：Remotion 是双许可，本项目按 Free License（个人）使用；**嵌入产品对外
   提供需另取许可**。HyperFrames 是 Apache 2.0，没有这层门槛。
2. **同构的确定性哲学**：逐帧 seek + FFmpeg 与我们已验收的「同一份讲稿渲染两次
   逐帧一致」是同一承诺，还有 golden MP4 回归测试的工程范式可借鉴。
3. **agent 生态**：21 个 skills + catalog 模式验证了 agent 侧工作流，与我们
   skills 分发的路子同构。

## 触发条件（满足其一再评估）

- foldercast 要**嵌进对外产品**，Remotion 许可成本成为现实约束；
- Remotion 版本升级或维护出现卡点，迁移成本低于留守成本；
- 需要它们已有的能力（shader 转场、Lambda 分布式渲染、catalog 模板生态）且自建
  不划算。

## 迁移范围（届时的工作量预估）

**不动的**（与引擎无关，这也是分层换引擎的本钱）：

- 契约层：`script.json` v2、digest、校验器全部不动——agent 的产物不变；
- 节拍对齐：时刻计算在 Node 侧（`durations.json` 实测音频 → 帧号），以数据传入
  渲染层，可移植；
- 配音、素材转换、page.html 导览页：全部不动。

**要重写的**：

- 8+3 个场景组件：React（`scenes/*.ts`，`useCurrentFrame` / `AbsoluteFill`）→
  HTML + CSS + seek 动画（`data-start` 时间轴 + adapter）；
- 渲染管线：`renderer/main.ts` 的 Remotion 组装 → hyperframes CLI / producer；
- 逐帧一致性测试：现有确定性用例改为对 hyperframes 渲染产物做基线对比。

## 风险

- 迁移期间两套引擎并存，逐帧基线要双份维护；
- hyperframes 年轻（2026-10 时 58k stars 但 API 未冻结），押注前等它的组合契约
  （`data-*` 属性语义）稳定；
- 入场曲线（`enter` 枚举 → 补间）要在新引擎里重新实现对齐现有手感。
