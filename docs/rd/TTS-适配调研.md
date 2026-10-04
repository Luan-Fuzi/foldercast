# TTS 适配调研

对应需求维度 1：**让用户自定义选择使用什么样的 TTS**。

调研日期：2026-10-04。API 细节以官方文档一手核实为准，标注来源。

---

## 一、结论先行

1. **不做单一引擎绑定。** 适配层统一接口，provider 可插拔。
2. **默认给三个就能覆盖绝大多数场景**：macOS `say`（零配置兜底）、Edge-TTS（免费、音色好）、小米 MiMo（官方推荐，中文自然）。
3. **小米 MiMo 值得作为一等公民**：它有**三个模型变体**——预置音色、**声音克隆**、**音色设计**。后两个是我们之前没注意到的能力：用户上传一段音频就能克隆音色，或用一句话描述设计全新音色。
4. **接口设计要点：把「音色」抽象成 provider 内的参数，而不是顶层概念。** 因为 MiMo 的音色是字符串 ID，Edge 的是 `zh-CN-YunxiNeural` 这样的枚举，而 `say` 的是系统音色名 —— 三者形态不同，硬统一会别扭。

---

## 二、候选供应商

| Provider | 类型 | 需要 key | 声音克隆 | 音色设计 | 备注 |
|---|---|---|---|---|---|
| **小米 MiMo** | 云端 API | 是 | ✅ | ✅ | 中文自然，模型分三档 |
| **Edge-TTS** | 云端（微软，走 edge-tts 库） | 否 | ❌ | ❌ | 免费，音色多，社区最常用 |
| **macOS `say`** | 系统原生 | 否 | ❌ | ❌ | 零安装兜底，音质一般 |
| **OpenAI 兼容端点** | 云端 | 是 | 视实现 | ❌ | 覆盖面最广，一个适配吃下很多家 |
| **Kokoro** | 本地 | 否 | ❌ | ❌ | `paperview`/`gitreel` 用的，模型约 80M |
| **GSV-TTS-Lite** | 本地 | 否 | ✅ | ❌ | DSH 生态有插件，中文克隆 |

**关于 OpenAI 兼容**：大量服务商（含 MiMo 自己的 Chat 接口）都兼容 OpenAI 的 `/v1/chat/completions` 形态。做一个 OpenAI 兼容 provider，等于一次性接上多家。优先级应高于逐个对接。

---

## 三、小米 MiMo TTS —— 一手核实

来源：[官方 API 文档 · 语音合成](https://mimo.mi.com/docs/zh-CN/api/audio/tts)

### 端点

```
POST https://api.xiaomimimo.com/v1/chat/completions
```

### 鉴权（两种，任选其一）

```
api-key: $MIMO_API_KEY          # 方式一
Authorization: Bearer $MIMO_API_KEY   # 方式二
```

### 三个模型变体（这是关键）

| model | 用途 | `audio.voice` 字段 |
|---|---|---|
| `mimo-v2.5-tts` | **预置音色**合成 | 可选，仅支持预置音色 ID，默认 `mimo_default` |
| `mimo-v2.5-tts-voiceclone` | **声音克隆** | **必填**，传音频样本的 base64（仅 `mp3` / `wav`） |
| `mimo-v2.5-tts-voicedesign` | **音色设计** | 不支持该字段；靠 `user` 消息里的描述文本指定音色 |

### 预置音色 ID

`mimo_default`、`冰糖`、`茉莉`、`苏打`、`白桦`、`Mia`、`Chloe`、`Milo`、`Dean`

### 请求体要点

```jsonc
{
  "model": "mimo-v2.5-tts",
  "messages": [
    // 【必填】用 user 消息承载「风格指令」，控制语气/语速/情绪
    { "role": "user", "content": "请用自然、清晰、适合知识讲解视频的旁白语气朗读。" },
    // 【必填】用 assistant 消息承载「要读的正文」
    { "role": "assistant", "content": "这是要被朗读的文本。" }
  ],
  "audio": {
    "format": "wav",              // wav | mp3 | pcm | pcm16（stream 时只能 pcm）
    "voice": "白桦"                // 仅 mimo-v2.5-tts 用
  },
  "stream": false
}
```

### 三个必须注意的点

1. **`assistant` 消息是「要读的文本」，不是普通的对话轮次。** 这是这个 API 最容易踩的坑 —— 它借用 chat 结构，其中 `user` = 风格指令，`assistant` = 正文。传错位置会得到空的或不相关的结果。
2. **`audio.format` 默认 `wav`。** 若要 `mp3` 需显式传入。我们之前用 wav 是对的。
3. **`optimize_text_preview`**（仅 voicedesign 支持）设为 `true` 时，模型会智能润色文本，此时可省略 `assistant` 消息。

### 响应

非流式时音频以 base64 放在 `choices[0].message.audio.data`。实测代码：

```python
audio = data["choices"][0]["message"]["audio"]["data"]
out.write_bytes(base64.b64decode(audio))
```

### 完整可运行参考

```python
def mimo_synth(text: str, out: Path, voice: str, api_key: str) -> None:
    body = json.dumps({
        "model": "mimo-v2.5-tts",
        "messages": [
            {"role": "user", "content": STYLE_INSTRUCTION},
            {"role": "assistant", "content": text},
        ],
        "audio": {"format": "wav", "voice": voice},
    }).encode()
    req = urllib.request.Request(
        "https://api.xiaomimimo.com/v1/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "api-key": api_key},
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read())
    out.write_bytes(base64.b64decode(data["choices"][0]["message"]["audio"]["data"]))
```

> 该实现参考自同作者的 `lecture-videos/scripts/tts.py`（已在真实项目中验证可用）。

### 其他信息

- MiMo 官网另有 **Token Plan** 订阅与按量计费两种模式，价格页：[mimo.mi.com/docs/zh-CN/price](https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go)
- 已发布 **MiMo-V2.6 系列**，接入时需确认 TTS 模型是否也随之更新（当前文档仍为 V2.5）
- 社区已有 ComfyUI 节点封装（含预置音色、音色设计、声音克隆），可作为参数用法的旁证：[ComfyUI-MiMo-TTS](https://github.com/TimekeeperXY/ComfyUI-MiMo-TTS)

---

## 四、适配层接口设计

### 核心思路

统一「合成一段文本成音频」这一个动作，其余差异交给 provider 自己处理。

```python
class Provider(Protocol):
    name: str
    requires_key: bool

    def voices(self) -> list[Voice]:        # 可选能力，不支持则返回 []
        ...

    def synth(self, text: str, out: Path, **opts) -> None:
        ...

    def caps(self) -> set[str]:
        """能力声明：{'clone', 'design', 'instruct', 'ssml'}"""
```

### 关键决策

**1. 音色是 provider 内的字符串，不做跨 provider 统一枚举。**
MiMo 是 `白桦`，Edge 是 `zh-CN-YunxiNeural`，`say` 是 `Meijia`。强行统一会丢失各家的表达力。配置里写 `provider` + `voice` 两个字段即可。

**2. 能力用 `caps()` 声明，不做能力探测。**
调用方按能力分支，而不是 try/except。比如声音克隆只在 `'clone' in caps()` 时暴露。

**3. 风格指令（instruct）是一等参数。**
MiMo 的 `user` 消息、Edge 的 `rate`/`pitch` 参数、`say` 的 `-r` 语速，都归到同一个语义下：**"怎么读"**。配置里是 `style` 字段，各 provider 自行翻译。

**4. 断点续跑是适配层外的职责。**
已存在的音频文件跳过（`--force` 覆盖）。这与 provider 无关，放在调度层。

### 配置形态

```jsonc
// foldercast.json
"voice": {
  "provider": "mimo",
  "voice": "白桦",
  "style": "自然、清晰、适合知识讲解的旁白语气",
  "format": "wav"
}
```

```bash
# CLI 覆盖
foldercast voice ./out --provider say
foldercast voice ./out --provider mimo --voice 冰糖
foldercast voice ./out --list-voices
```

### key 的存放

**不要经过聊天记录或命令行参数。** 复用 DSH 的凭据 seam（`dsh-credentials`），自己不实现查找逻辑。

解析优先级由 `dsh-credentials-local` 固定：

| 顺序 | 位置 | 可写 | 说明 |
|---|---|---|---|
| 1 | 启动环境（`MIMO_API_KEY=… dsh`） | ❌ | 只读。按次覆盖代表本次运行的明确意图，**产品内无法修改**，保存会被拒 |
| 2 | 凭据存储 `$DSH_HOME/.credentials.yaml` | ✅ | 文件权限 600；界面或 `ctx.credentials.set` 写入；变更自动重载、跨重启保留 |
| 3 | 项目 `.env`（`<invocation cwd>/.env`） | 不在此处 | 项目级隔离靠这一层 |
| 4 | `$DSH_HOME/.env` | 不在此处 | |

**配置里只放引用名**，例如 `ttsKeyRef: "MIMO_API_KEY"`。

**与旧设计的变化**：原设计写的是「项目根的 `.<provider>_key` 文件」，现改为 DSH 的项目 `.env` 层。`lecture-videos` 那种 `.mimo_api_key` 文件**不再需要**——不过它仍被 [ADR 0007](../decisions/0007-secret-file-exclusion.md) 的默认排除规则覆盖（`.*_key`），所以即使留着也不会被读进模型。

**这不是隔离**：凭据文件只对 OS 用户可读，而 agent 的工具进程以同一用户身份运行。官方原话：「agent 不是另一个用户……这是审慎，不是边界。」

### key 未配置时的行为

用户可能先装插件、过一段时间才配 key。**所以"没有 key"必须是可用的正常状态，不是错误状态。**

分三层处理：

**第一层 · 零配置就能跑（降级到免密钥 provider）**

| provider | 需要 key |
|---|---|
| `say`（macOS 原生） | ❌ |
| `edge`（Edge TTS） | ❌ |
| `mimo` / OpenAI 兼容 | ✅ |

**默认 provider 是 `say`。** 装了插件不配任何东西就能出片，只是音色一般。用户满意就永远不用配 key——这与第一节「默认给三个就能覆盖绝大多数场景」的设计一致。

**第二层 · 选了需要 key 的 provider 但没配 → 前置检查 + 结构化引导**

调用 `ctx.credentials.describe(ref)`，**在发起合成之前**判断：

```ts
const info = await ctx.credentials.describe(ref)     // { configured, source?, writable }
if (!info.configured) {
  return { ok: false, reason: 'credential-missing', ref,
           hint: '在设置里保存 MIMO_API_KEY，或设为环境变量；也可先用 say 出片' }
}
```

**为什么必须前置**：等到 API 返回 401 才发现，错误信息是外部给的，措辞不受我们控制，用户看不出该怎么办。

**第三层 · 给用户一个配置途径**

| 方式 | 成本 | 状态 |
|---|---|---|
| 宿主为 `Config` 里的引用名字段自动渲染凭据控件 | 零 | **未确认**——官方文档说了"可以通过配置界面保存凭据"，但没写这个绑定对任意插件字段是否生效 |
| 我们自己在设置页加一个保存控件的分区（`settings.section` + `ctx.credentials.set`） | 一个客户端包 | 确定能做，但要写 React |
| **工具里加一个保存动作**，对话里让 agent 代为保存 | 很低 | **确定能做，零 UI。第一版用这条** |

第三种的具体形态：一个 `foldercast_set_key` 动作，只收「存哪个引用名」，**值不进聊天记录**（由用户在本地那一步自己输入）。

**若第一种后来被证实可用**，把它作为主路径、第三种作为 fallback；两者都不够时再补客户端包。

---

## 五、字幕与时长

字幕**不由 TTS 负责**，与 provider 无关。流程：

1. TTS 合成 → 音频文件
2. `ffprobe` 实测每段真实时长
3. 按标点切分字幕块（`。！？；：` 优先，超 24 字再在 `，、` 切）
4. 按字符数把实测时长分配到各块

**为什么必须实测**：不同引擎、不同语速下，同一段文字时长差异可达 30%。用预估字数配时会累积漂移，到视频后半段字幕与配音完全对不上。

---

## 六、待办

- [ ] 确认 MiMo-V2.6 是否提供新版 TTS 模型
- [ ] 核实 MiMo Token Plan 与按量计费的额度上限，评估长视频成本
- [ ] 声音克隆的音频样本要求（时长下限、采样率、文件大小上限）
- [ ] 音色设计（voicedesign）的实际效果与稳定性
- [ ] 是否接入本地 provider（Kokoro / GSV-TTS）—— 决定要不要引入模型下载
- [ ] 是否提供「试听」功能：合成一句样本供用户选音色
