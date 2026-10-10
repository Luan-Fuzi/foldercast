# 场景与创作参考

本文件按需读取。版本号以主 skill 和 contracts 导出的常量为准。digest 是事实库，script 是自足的渲染输入，渲染器不读取 digest。

## 场景类型

| type | 用途 | 必需字段 |
|---|---|---|
| `cover` | 开场与主题 | `title` |
| `tree` | 目录结构与模块关系 | `entries`（`path`、`files`，可选 `bytes` / `highlight`） |
| `inventory` | 内容构成与计数 | `groups`，可选 `total` |
| `file` | 文件内容与原文摘录 | `file`，可选 `note` / `excerpt` / `excerptStart` |
| `gallery` | 图片集合 | `items` |
| `clip` | 视频封面与区间标注，不播放活动画面 | `source`，可选 `clipRange` |
| `document` | Office / PDF 页图 | `source`，可选 `pages`（页码从 1 起） |
| `concept` | 论断与支撑要点 | `statement`，可选 `points` |
| `compare` | 两组内容比较 | `left` / `right`，各为 `{ label, lines }` |
| `flow` | 流程与管线 | `steps`（`{ label, note? }` 数组，最多 6 步） |
| `outro` | 收束与回顾 | `title`，可选 `lines` |

所有场景还需要唯一 `id`、`type`、`narration`、`beats`。按内容形态选场景：论断用 concept，对比用 compare，流程用 flow，具体原文用 file。file 场景需要可展示的素材或摘录；避免连续展示内容近似的卡片。

## 事实与摘录

digest.excerpts 使用 `{ file, lines, start, why }`：原文行、首行的 1 基行号及选材理由。写稿时将原文与行号放入 excerpt / excerptStart，不要改写后当作原文。数字应按说明过的口径核对；可用确定性的工具统计，由模型决定数字是否值得讲。

Office 转换页数可能与原应用分页不同。要讲页数，先说明依据。证据不足的事实保留不确定性，或者不采用。

## 创作建议与校验提示

以下是默认建议，不是所有内容的质量标准。机器 warning 需要结合目标判断，不能直接当成内容不合格。

- 结构可从「总—分—总」开始。演示、排障和问题驱动的讲述可以采用其他顺序，但观众需要知道主题、关系和结论。
- 时长优先服从受众与讲述深度。代码量仅供粗估：小型目录可从 3–4 分钟起，中型 5–8 分钟，大型 8–15 分钟；文档目录与复杂概念不应机械套用。目标写入 video.targetDurationSec，旁白估时警告不代表实测时长。
- 每场讲一个主题，旁白通常 40–80 字；过长时检查是否应拆场。短句与标点要能满足主 skill 的字幕宽度限制。
- 摘录通常选 8–12 行完整语义块。校验器对少于 6 行的摘录会提示；短定义或长代码可以有合理例外，仍应检查可读性。
- 画面阅读量与旁白量之比参考 1.5–3 倍。density-out-of-band 是信息量提示，不证明画面溢出、空白或质量差；必须看实际内容和预览。
- beats 使用 `{ points: ["…"], enter: "reveal" }`，enter 可选 fade / reveal / grow / slide。inventory 可用 `{ graphic: "proportion", enter: "grow" }`。第 i 拍随第 i 个字幕块出现；检查要点与旁白的对应关系。
- 少用套话，使用可核查的文件、数字与关系。删除无用的思考过程，但保留会影响观众判断的真实不确定性。
