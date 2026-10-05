# 数据格式

定义三样东西：

1. `foldercast.json` —— **目录解读**，由程序产出，可重算
2. `script.json` —— **讲稿**，由叙事层或人产出，是创作，重跑会得到不同结果
3. `assets/` —— 素材目录，可重算的缓存

**为什么解读与讲稿分成两份文件**：一份理解可以对应多种讲法（讲给同事的、讲给三个月后自己的），共用同一份分析结果。而且两者性质不同——`foldercast.json` 删了能重建，`script.json` 删了就丢了创作。合在一个文件里，重跑分析就会覆盖讲稿。

---

## 工作目录（所有产物的落点）

所有产物写进源目录下的隐藏目录 `<源目录>/.foldercast/`。它是**唯一的工作根，第一版不可配置**：

```
<源目录>/.foldercast/
├── foldercast.json     解读（可重算）
├── script.json         讲稿（创作）
├── review.md           评审结论（M5，agent 产出）
├── assets/             素材（可重算）
├── audio/scene-N.wav   逐场景音频（阶段③）
├── durations.json      实测时长（阶段③）
└── out/                产物出口
    ├── index.html      HTML 视图（M6）：自包含单文件页面
    └── *.mp4           成片（M7）
```

**为什么放在源目录下**：源目录只多一个隐藏目录，不散落文件；解读、讲稿、素材同处一处，重跑分析不会碰到讲稿。

**`out/index.html` 只读解读与素材**（M6）：它不依赖讲稿，所以写完稿之前就能看 —— 结构树、
内容盘点、入口与枢纽、引用依赖图、文件卡片、密钥审计都在里面。**没有 JavaScript、没有外部资源**：
图片按页面尺寸缩小后内联成 data URI（素材阶段已经有缩小版的直接用），超过内联预算的退回相对路径
并在页脚说明。生成方式是 `pnpm html <目录>`，插件里由 `foldercast_cast` 顺手跑（阶段名 `html`）。

**`review.md` 为什么是 Markdown，不是 JSON**：它由评审 subagent 产出（[ROADMAP M5](../ROADMAP.md)），每条判据都要带
「文件路径 + 原文片段」这类证据，给人抽查用。它没有机器判据——校验器（M3）不读它，渲染也不消费它，
所以不纳入本文件的 schema 体系。格式与逐条判据见 skill 的「评审判据」一节；重跑评审会覆盖它。

**两条路径基准，不要混用**：

| 字段 | 相对于 |
|---|---|
| `manifest[].path`、场景的 `file` / `source` | **源目录**（被讲解的目录） |
| 场景的 `asset` / `items` / `poster` / `pages`、`durations.json` 的 `audio` | **工作根** `.foldercast/`，所以这些值以 `assets/` 或 `audio/` 开头 |

`outputDir` 做成配置项押后（[INTEGRATION §11.5](../INTEGRATION-dsh-plugin.md#115-计划暴露给用户的配置日后)）。

---

## 一、`foldercast.json`

写在上面那个工作根的根下。

### 顶层结构

```jsonc
{
  "foldercast": 1,              // 格式版本，整数，破坏性变更时递增
  "generatedAt": "2026-10-04T17:30:00+08:00",
  "source": {
    "root": "/abs/path/to/target",   // 被讲解的目录（绝对路径）
    "label": "我的项目",              // 展示用名称，默认取目录名
    "focus": ["src", "docs"]         // 可选：只讲这些子路径
  },

  "sources": { /* 内容筛选，见下 */ },
  "stats":   { /* 分析统计，见下 */ },
  "manifest": [ /* 文件清单，见下 */ ],
  "graph":   { /* 引用依赖图，见下 */ },

  "video": { /* 输出规格，见下 */ },
  "voice": { /* 配音配置，见下 */ },
  "style": { /* 风格，见下 */ }
}
```

**讲稿不在这个文件里** —— 它是独立的 `script.json`（见第七节）。同一份解读可以配多份讲稿。

---

### `sources` —— 内容筛选（维度 2）

三级筛选，按顺序生效：

```jsonc
"sources": {
  // 1. 只考虑这些子路径（空 = 全目录）
  "include": ["src/**", "docs/**", "README.md"],

  // 2. 排除匹配项，gitignore 风格，后面的规则覆盖前面的
  "exclude": [
    "node_modules/**",
    "**/*.min.js",
    "*.lock",
    "!docs/important.lock"     // 前缀 ! 表示重新包含
  ],

  // 3. 类型级开关：整类内容不参与
  "kinds": {
    "video": false,            // 不讲视频文件
    "audio": false,
    "archive": false
  },

  // 4. 规模保护
  "maxFiles": 200,             // 分析上限，超出按重要性截断
  "maxFileSizeMb": 5,          // 单文件超过则不读取内容（仍计入结构树）
  "maxDepth": 6,               // 结构树展示深度

  // 5. 覆盖密钥判据（误拦时用，见 stats.secrets）
  "rescan": ["docs/tutorial.md"]
}
```

**默认排除**（无需用户配置，开箱即用）：

```
# 生成物与依赖 —— 讲它们没有信息量，且会把文件数撑爆
.git/**  node_modules/**  .venv/**  venv/**  __pycache__/**
dist/**  build/**  out/**  target/**
*.min.js  *.min.css  *.map  *.lock  package-lock.json  pnpm-lock.yaml
.DS_Store  Thumbs.db

# 密钥类文件名 —— 不读内容（见 ADR 0007）
.env  .env.*  *.env
credentials.json  secrets.json  .netrc
*.pem  *.key  *.p12  *.pfx  *.keystore
id_rsa  id_dsa  id_ecdsa  id_ed25519
.*_key  *_api_key  *_token  *_secret
```

理由：前一组是**生成物或依赖**，讲它们没有信息量，且会把文件数撑爆。

后一组按**文件名**排除，不做内容检测 —— 理由与代价见 [ADR 0007](../decisions/0007-secret-file-exclusion.md)。这条规则**不可能完备**：硬编码在源码里的密钥、用户自定义命名的密钥文件都会被读到。用户可用 `sources.exclude` / `sources.include` 覆盖。

**筛选是否好做**：好做。本质是一次 glob 匹配，`pathspec` / `micromatch` 级别的库就能覆盖，不需要模型参与。唯一要小心的是默认排除规则不要误伤（比如把 `build.gradle` 当成 `build/**` 排除掉 —— 所以规则要按**目录**匹配而非子串匹配）。

---

### `stats` —— 分析统计

由程序产出，供写稿阶段引用。

```jsonc
"stats": {
  "totalFiles": 128,
  "totalBytes": 2451233,
  "maxDepth": 4,
  "kindCounts": {              // 与 kinds 枚举对应
    "code": 74, "text": 21, "image": 12,
    "video": 3, "office": 4, "pdf": 2,
    "data": 8, "archive": 0, "other": 4
  },
  "languages": {               // 按代码行数排序，Top 10
    "TypeScript": 4200, "Python": 1800, "CSS": 900
  },
  "topDirs": [                 // 文件数最多的子目录，Top 8
    { "path": "src/components", "files": 34 },
    { "path": "docs", "files": 18 }
  ],
  "roles": {                   // 按识别出的角色
    "readme": ["README.md"],
    "entry": ["src/index.ts", "package.json"],
    "config": ["tsconfig.json"],
    "test": ["src/index.test.ts"],
    "doc": ["docs/SPEC-pipeline.md"],
    "asset": ["public/img/math01_eig.png"],
    "license": ["LICENSE"],
    "build": ["scripts/tts.py"]
  },

  "secrets": { /* 密钥文件的排除审计，见下 */ }
}
```

8 个角色（与 schema 的 `$defs.role` 一致）：

| role | 判据 | 例 |
|---|---|---|
| `readme` | 根或子目录的说明文件 | `README.md` |
| `entry` | 主入口 | `src/index.ts`、`src/Root.tsx`、`package.json` |
| `config` | 配置 | `tsconfig.json`、`remotion.config.ts` |
| `test` | 测试 | `src/index.test.ts` |
| `doc` | 文档 | `docs/SPEC-pipeline.md` |
| `asset` | 被引用的素材 | 图片、音频、`public/**` 下的文件 |
| `license` | 许可证 | `LICENSE` |
| `build` | 构建产物与构建脚本 | `dist/**`、`scripts/build.py` |

一个文件**最多一个角色**，无法判定则缺省。统计里某角色没有文件时，该键不出现。

---

### `graph` —— 引用依赖图（理解的组成部分）

只放**骨架**，边挂在上面的 `manifest` 里。这样图很大时不必整体读入。

```jsonc
"graph": {
  "nodes": 128,
  "edges": 274,
  "roots": ["README.md", "src/index.ts"],           // 无入边 = 入口
  "hubs": [                                          // 入度最高 = 最该先讲的
    { "path": "docs/SPEC-pipeline.md", "in": 10, "out": 2 },
    { "path": "docs/SYSTEM-DESIGN.md", "in": 8, "out": 9 }
  ],
  "leaves": ["docs/conventions/git.md"],             // 无出边 = 末端
  "dangling": ["src/missing-util.ts"]                // 指向不存在的路径，可能是坏引用
}
```

**这节回答的问题**：哪些文件是入口、哪些是枢纽、依赖方向是什么。靠文件大小和数量看不出来。写稿时按 `roots` → `hubs` → 其余的顺序讲，比按目录树字母顺序讲更接近真实的阅读顺序。

依赖的识别按 `kind` 分：

| kind | 识别方式 |
|---|---|
| `code` / `markup` | `import` / `require` / `from` 语句，按语言语法 |
| `text` / `data` | Markdown 链接与图片引用；JSON/YAML 里的相对路径字符串 |
| `office` / `pdf` | 文档里出现的其他文件名（弱信号，记入但不计入度数） |
| 其他 | 不识别 |

---

### `stats.secrets` —— 密钥文件的排除审计

被排掉的密钥类文件**仍进结构树与计数**（"这里有个 `.env`"本身有信息量），但内容不读、不出现在 `manifest[].preview`、不生成素材。

```jsonc
"secrets": {
  "excluded": [
    { "path": ".env",            "match": ".env" },
    { "path": ".mimo_api_key",   "match": "*_key" },
    { "path": "config/prod.pem", "match": "*.pem" }
  ],
  "rescanned": ["docs/tutorial.md"]     // 用户用 sources.rescan 显式放回的文件
}
```

**这一节必须打印出来。** 判据只按文件名匹配，不可能完备 —— 用户靠这份清单确认命中了什么、有没有该排除却没排除的。放回方式：`sources.rescan`。

**密钥文件不占 `maxFiles` 的配额，也不会被截断。** 它们本来就不读内容（零成本），而审计必须完整：
被截掉的密钥等于没报出来 —— 清单里没有、结构树里也没有，用户在 `stats.secrets.excluded` 里
看不到它，与上面「仍进结构树与计数」的承诺矛盾。（2026-10-05 修：一个 200 文件的目录里
`lecture-videos/.mimo_api_key` 就是这样消失的，`sources.maxFiles` 截断时把它一起丢了。）

判据范围与已知短板见 [ADR 0007](../decisions/0007-secret-file-exclusion.md)。**明确不做**：内容签名比对、熵检测。

---

### `manifest` —— 文件清单

每个文件一条。**这是写稿阶段模型看到的主要内容**。

```jsonc
"manifest": [
  {
    "path": "src/index.ts",        // 相对 source.root
    "kind": "code",                // 见 kinds 枚举
    "role": "entry",               // 见 roles，无则缺省
    "bytes": 2048,
    "lines": 78,
    "language": "TypeScript",      // 代码/标记文件才有
    "title": "主入口",              // 从首个注释或标题提取，可缺省
    "preview": "export function main() { ... }",  // 截断预览，≤200 字
    "asset": "assets/src_index_thumb.png",        // 若已生成素材
    "imports": ["src/util.ts", "src/types.ts"],   // 它引用了谁（≤40 条，超出记 importsCount）
    "importsCount": 2,
    "importedBy": ["src/app.ts", "src/cli.ts"],   // 谁引用它：按引用方出度排序取前 5
    "importedByCount": 7                          // 真实入度，反映枢纽地位
  }
]
```

`preview` 的提取策略按类型分：

| kind | preview 来源 |
|---|---|
| `code` | 首个块注释，或前 10 行 |
| `text` | 首个标题 + 首段 |
| `office` | 文档标题 + 大纲/工作表名/幻灯片标题 |
| `pdf` | 元数据标题 + 首页文本前 200 字 |
| `image` | 尺寸 + EXIF 摘要 |
| `video` | 时长 + 分辨率 + 编码 |
| `data` | 表头 + 行数 |

---

### `video` —— 输出规格

```jsonc
"video": {
  "width": 1920, "height": 1080, "fps": 30,
  "targetDurationSec": 180,      // 期望时长；null = 由内容决定
  "language": "zh-CN"            // 旁白与字幕语言
}
```

`targetDurationSec` 是**软约束**：写稿阶段用它反推字数上限（中文按约 4.3 字/秒估算），不硬截断。

---

### `voice` —— 配音配置（维度 1）

```jsonc
"voice": {
  "provider": "mimo",                            // mimo | edge | say | openai-compatible …
  "voice": "白桦",                                // provider 内的音色标识
  "style": "自然、清晰、适合知识讲解的旁白语气",     // 「怎么读」，各 provider 自行翻译
  "format": "wav"                                // wav | mp3，默认 wav
}
```

- **音色不做跨 provider 统一枚举**。MiMo 是 `白桦`，Edge 是 `zh-CN-YunxiNeural`，`say` 是 `Meijia` —— 强行统一会丢失各家的表达力。`provider` + `voice` 两个字段表达即可。
- `style` 是「怎么读」的统一语义：MiMo 落在 `user` 消息，Edge 落在 `rate`/`pitch`，`say` 落在 `-r`。
- **换 provider 或换音色只需重跑阶段③**，不改 `scenes`（见 [SPEC-pipeline.md](SPEC-pipeline.md#可重跑边界)）。
- 本字段是**配置意图**；实际使用的 provider 与音色以阶段③产出的 `durations.json` 为准（见本文第四节）。
- **密钥不放这里**。配置里只放引用名（`keyRef`，如 `MIMO_API_KEY`），值走 DSH 的凭据 seam，解析优先级与"未配置时的行为"见 [../rd/TTS-适配调研.md](../rd/TTS-适配调研.md#key-的存放)。

---

### `style` —— 风格（维度 3）

```jsonc
"style": {
  "preset": "swiss",             // 预设名，见 styles/
  "overrides": {                 // 覆盖预设里的任意 token
    "palette.bg": "#0B1B2B",
    "typography.title": "\"Songti SC\", serif",
    "motion.pace": "slow"
  },
  "natural": "把背景换成深蓝，标题用衬线体，节奏放慢",  // 可选：自然语言描述
  "unresolved": ["活泼一点"],    // 映射不到 token 的片段，不静默丢弃
  "resolvedAt": "2026-10-04T17:30:00+08:00"
}
```

`natural` 由模型解析成 `overrides`，解析结果**回写进 overrides**，这样渲染阶段不需要再调用模型。
解析不了的片段写进 `unresolved` 并报错，而不是丢掉。

token 清单见 [../rd/风格预设系统.md](../rd/风格预设系统.md)。

---

## 二、`script.json` —— 讲稿（创作）

放在 `foldercast.json` 旁边。**这是 M5（写稿）的产物，可以被重写而不影响解读。**

```jsonc
{
  "foldercast": 1,                    // 引用的是哪一版解读格式
  "source": { "root": "/abs/path/to/target" },
  "generatedAt": "2026-10-04T18:10:00+08:00",
  "title": "我的项目 · 导览",           // 可选：整片的标题
  "scenes": [ /* 见下 */ ]
}
```

### `scenes` —— 分镜

```jsonc
"scenes": [
  {
    "id": "cover",
    "type": "cover",
    "title": "我的项目",
    "subtitle": "一个用来做 X 的工具",
    "narration": "这是……",       // 配音文本 + 字幕来源
    "durationSec": null           // null = 阶段③按实测音频回填
  },
  {
    "id": "structure",
    "type": "tree",               // 结构树
    "title": "目录结构",
    "narration": "整个目录分成三块……",
    "highlight": ["src", "docs", "tests"]
  },
  {
    "id": "inventory",
    "type": "inventory",          // 内容盘点：多少块、各是什么
    "title": "这里面有什么",
    "narration": "……",
    "groups": [
      { "kind": "code",  "count": 74, "note": "TypeScript 为主" },
      { "kind": "text",  "count": 21, "note": "文档与说明" }
    ]
  },
  {
    "id": "code-demo",
    "type": "file",               // 单文件展示
    "title": "主入口",
    "narration": "……",
    "file": "src/index.ts",
    "asset": "assets/src_index_code.png",
    "focusLines": [1, 20]         // 高亮行区间
  },
  {
    "id": "image-demo",
    "type": "gallery",            // 图片墙
    "narration": "……",
    "items": ["assets/a.png", "assets/b.png"]
  },
  {
    "id": "video-demo",
    "type": "clip",               // 视频片段（关键帧 + 片段播放）
    "narration": "……",
    "source": "demo.mp4",
    "poster": "assets/demo_poster.png",
    "clipRange": [12.0, 20.0]
  },
  {
    "id": "office-demo",
    "type": "document",           // Office/PDF 展示
    "narration": "……",
    "source": "report.docx",
    "pages": ["assets/report_p1.png", "assets/report_p2.png"]
  },
  { "id": "outro", "type": "outro", "title": "完", "narration": "……" }
]
```

### 场景类型清单（MVP）

| type | 用途 | 必需字段 |
|---|---|---|
| `cover` | 封面 | `title` |
| `tree` | 组织结构（需求 1） | `highlight` |
| `inventory` | 内容盘点：分几块、各是什么（需求 2） | `groups` |
| `file` | 单个文件展示（代码/文本） | `file`，可选 `asset`/`focusLines` |
| `gallery` | 图片墙 | `items` |
| `clip` | 视频片段 | `source`，可选 `poster`/`clipRange` |
| `document` | Office/PDF 分页 | `source`、`pages` |
| `outro` | 结尾 | `title` |

上表的必需字段由 [script.schema.json](script.schema.json) 的 `allOf` 表达，**校验器（`pnpm validate`）会连同路径引用一起查**。schema 查不了的（路径是否存在、字幕能不能切开）由校验器补，见本文第五节。

后续可扩展：`timeline`（时序）、`compare`（对比）、`metrics`（数据卡）。

---

## 三、`assets/` 素材目录

```
assets/
  thumbs/        每个文件的缩略图（图片直接缩放，视频抽首帧）
  pages/         Office/PDF 逐页转图
  frames/        视频关键帧
  code/          语法高亮的代码图（SVG）
  posters/       视频封面图
  text/          Office/PDF 提取出的文本（Markdown，供叙事层通读）
  manifest.json  素材清单
```

**素材阶段会回填解读**：`foldercast.json` 的 `manifest[].asset`（该文件的主素材路径），以及
office / pdf / video 的 `preview`（M1 读不了这些格式，留给本阶段填）。解读仍是**可重算**的——
两个阶段都是确定性程序，重跑顺序固定为「分析 → 素材」。

### `manifest.json` —— 素材清单

机器可读的 schema 在 [assets.schema.json](assets.schema.json)。

```jsonc
{
  "assets": 1,                        // 清单格式版本
  "generatedAt": "2026-10-04T17:30:00+08:00",
  "source": { "root": "/abs/path/to/target" },
  "entries": [
    {
      "path": "report.docx",          // 相对 source.root
      "kind": "office",
      "mtimeMs": 1759600000000,       // 源文件 mtime
      "size": 34951,
      "hash": "sha256:1f3a…",         // 内容哈希；增量判据是 mtime+size，哈希用于核对
      "products": [
        { "role": "page", "path": "pages/report_p1.png", "width": 1191, "height": 1684 },
        { "role": "thumb", "path": "thumbs/report.png", "width": 640, "height": 905 }
      ],
      "text": {                       // 提取出的结构化信息（office / pdf）
        "markdown": "text/report.md", // 全文，叙事层读这个
        "outline": [ { "level": 1, "text": "季度汇报" } ],
        "sheetNames": ["Summary"],    // xlsx
        "slideTitles": ["项目概述"],   // pptx
        "tableCount": 6
      },
      "meta": { "durationSec": 12.48, "width": 1920, "height": 1080, "codec": "h264" },  // video / 图片尺寸
      "error": "可操作的失败说明"       // 单个文件失败不影响整体（coding.md 五）
    }
  ]
}
```

**`role` 取值**：`thumb`（缩略图）、`page`（Office/PDF 逐页）、`poster`（视频封面）、`frame`（视频关键帧）、`code`（语法高亮图）。路径**相对工作根**，与讲稿里 `asset` / `items` / `pages` 的基准一致。

**增量重算**：`mtimeMs` + `size` 与上次一致、且产物文件仍在，就跳过该文件（不重算、不重新过滤）。哈希只在 mtime 变化时重算，用于确认内容真的变了。

**失败不中断**：单个文件转换失败写 `error` 字段并继续，最后在摘要里列出（`coding.md` 五）。

### 各类内容的提取方式（零新系统依赖）

| kind | 提取方法 | 依赖 |
|---|---|---|
| `image` | 缩放 + 生成缩略图 | `sips`（macOS 原生）或 ffmpeg |
| `video` | 抽关键帧 / 首帧封面；时长与分辨率用 `ffprobe` | `ffmpeg` / `ffprobe` |
| `pdf` | **逐页转 PNG**（文字层提取走 `officeparser`） | **`dsoffice render`** —— 接受 PDF 输入，不需要 `pdftoppm`/poppler |
| `office` `.docx/.pptx` | 文本结构化提取（大纲、幻灯片标题）；**转图直接用 `dsoffice render`** | `officeparser`（Node，带层级 AST）+ `dsoffice` |
| `office` `.xlsx` | 表头与数据提取；**公式值用 `dsoffice recalculate` 重算** | `officeparser` + `dsoffice` |
| `code` | 语法高亮图（**SVG**：渲染器本来就是浏览器，不需要截图工具） | `shiki`（npm） |
| `text` | 无需素材，直接排版 | — |

**`dsoffice` 是什么**：`@deepseek-ai/libreoffice-kit`，DeepSeek 随 DSH 分发的**预编译 LibreOffice 引擎**（MPL-2.0，147 MB / 平台，作为 optionalDependency 按平台安装）。它**不查找也不需要系统装的 LibreOffice**。

```sh
dsoffice render      --input report.docx --output-dir pages --pages 1
dsoffice convert     --input report.docx --output report.pdf
dsoffice recalculate --input budget.xlsx --output recalculated.xlsx
```

**能力边界**（官方声明）：**不保证与 Microsoft Office 的分页一致**——字体度量差异会改变换行与分页。对"演示画面"够用，但不要承诺与原文档逐页相同。

**PDF 的文字提取**：`officeparser` v8 起对**带文本层**的 PDF 产出 heading 层级与表格节点，因此不为 PDF 单独引入文本库。扫描版 PDF 没有文本层，只能靠页面图，narration 由叙事层依据画面与文件名决定（[ADR 0006](../decisions/0006-narration-layer-moves-up.md) 允许它读内容）。

**注**：本机 ffmpeg **未编译 libass/freetype**，`subtitles` 与 `drawtext` 滤镜不可用。因此字幕不走 ffmpeg 烧录，而是由渲染阶段（Remotion）绘制。这与 [SPEC-pipeline.md](SPEC-pipeline.md) 的「字幕由渲染层负责」一致。

---

## 四、`durations.json`（阶段③产物）

```jsonc
{
  "provider": "mimo",               // 实际使用的 provider，覆盖 foldercast.json 的 voice 配置
  "voice": "白桦",
  "scenes": [
    {
      "id": "cover",
      "audio": "audio/scene-0.wav",
      "duration": 12.48,          // ffprobe 实测
      "subs": [                   // [文本, 该块时长秒]
        ["这是……", 6.2],
        ["……", 6.28]
      ]
    }
  ]
}
```

字幕切分规则（沿用 `lecture-videos` 已验证的做法）：

1. 先按句末标点切：`。！？；：`
2. 超过 24 字的块，再在 `，、` 处二次切分
3. 相邻块若合并后仍 ≤24 字则合并（避免孤行）
4. 每块时长按**字符数**占比分配实测总时长

**「24 字」按显示宽度折算**：中日韩文字与全角标点算 1，其余（半角标点、拉丁字母、数字）算 0.5。24 本来就是屏幕上一行的容量，中英混排按折算算才与画面一致；纯中文文本下它与「数汉字个数」等价。算法与常量在 `packages/plugin/scripts/contracts/subtitles.ts`（`SUB_LIMIT`），校验器与配音阶段共用同一份实现。

**切不动时校验器会报错**：整块没有任何可切点（例如一长串没有标点的文字）时，硬切会产生半个词，所以切分器原样保留该块，由校验器报出来让人改稿。

---

## 五、版本与兼容

- `foldercast` 字段是整数版本号。新增可选字段不递增；**破坏性变更**（改字段语义、删字段）递增。
- `foldercast.json` 与 `script.json` **各自独立版本化**。解读格式升版不必要求讲稿同步升版，只要 `script.json` 声明的版本仍被支持。
- 读取方遇到未知版本应报错而非猜测。
- 场景 `type` 是开放枚举：遇到不认识的 type，渲染器应跳过并警告，而不是崩溃。
- **schema 在各层都是封闭的**（`additionalProperties: false`）：出现未声明的字段就是错误，拼错的键名会被拦住。例外只有真正的映射字段——`stats.languages`、`stats.kindCounts`、`stats.roles`、`sources.kinds`、`style.overrides`，它们允许自由键。加字段意味着**同时**改 schema、本文件与 `packages/plugin/scripts/contracts/` 的类型。

### 契约校验（`pnpm validate <目录>`）

schema 只能表达**形状**，另有一层校验查形状之外的东西，两者都要过：

| 层 | 查什么 | 谁的判据 |
|---|---|---|
| JSON Schema | 类型、枚举、必需字段、封闭性 | `specs/*.schema.json` |
| **解读自洽** | `stats` 是 `manifest` 的投影、图上路径都是真实节点、度数对得上 | 本文第一节 |
| **跨文件引用** | 讲稿里的 `file` / `source` 必须在解读的 `manifest` 里；`asset` / `items` / `poster` / `pages` 必须在素材清单里（**幻觉路径拦截**） | 本文第二节「工作目录」的两条基准 |
| 场景语义 | 该场景类型用不上的字段、`highlight` 是不是真实子路径、`focusLines` 是否超出文件行数 | 本文第二节的场景类型清单 |
| 字幕 | `narration` 能否切成每块 ≤24 字的字幕块 | 本文第四节 |

**边界**：它只查机器能判断的。**「有没有讲错重点」不在这一层**，那是写稿之后的评审 agent（M5）。
