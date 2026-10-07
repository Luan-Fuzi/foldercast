/**
 * 视图模型：`script.json` 的场景 → 页面区块（**纯计算**，不读文件、不跑命令）。
 *
 * 与渲染分开（`render.ts` 只吃这里的结构）：视图模型拿讲稿夹具直接断言，HTML 的正确性
 * 不必靠「跑一遍浏览器看看」来判断。这一层与 M6 被删的 `html/collect.ts` 同一职责，
 * 但输入从「解读 + 素材清单」换成了讲稿 —— 讲稿就是清单，页面只是它的另一个出口。
 *
 * 三条约定：
 *
 * 1. **页面只讲讲稿里有的东西**。结构、盘点、摘录原文全部来自场景字段，这里不做统计、
 *    不猜内容；比例（条形图宽度、百分比）从讲稿数字算出来，不四舍五入成「约」。
 * 2. **顺序确定**。区块按场景顺序排，引用清单按首次出现去重；同一份讲稿两次收集
 *    得到同一个视图模型。
 * 3. **不认识的东西跳过并记录**（`skipped`），不崩 —— 与渲染器对开放枚举的态度一致。
 *    （渲染入口会先跑契约校验把未知类型拦成 blocker，这里是兜底。）
 */
import type { ScriptDocument, Scene } from '../contracts/script.ts';
import { prepKindOf } from '../contracts/prep.ts';

/** 区块公共字段。`title` 一定有值：场景没写就按类型给缺省（文件类取文件名）。 */
type SectionCommon = {
  id: string;
  title: string;
  /** 配音文本。页面里作为区块的引文展示。 */
  narration: string;
};

export type HeroSection = SectionCommon & {
  kind: 'hero';
  subtitle?: string;
};

/** tree：一行一个子路径，条形图按 files 占最大值的比例画宽。 */
export type StructureRow = {
  path: string;
  files: number;
  bytesLabel?: string;
  share: number;
  highlight: boolean;
};
export type StructureSection = SectionCommon & {
  kind: 'structure';
  rows: StructureRow[];
};

/** inventory：一组一行，`share` 是 count / total（条形图宽度按它，超 100% 按 100% 截）。 */
export type InventoryRow = {
  label: string;
  count: number;
  note?: string;
  share: number;
};
export type InventorySection = SectionCommon & {
  kind: 'inventory';
  rows: InventoryRow[];
  total: number;
};

export type FileSection = SectionCommon & {
  kind: 'file';
  /** 相对源目录的路径（讲稿原文）。 */
  file: string;
  note?: string;
  /** 摘录的原文行，进代码块。 */
  excerpt: string[];
};

/** gallery 的一项。`isImage` 只看扩展名：非图片（视频等）本阶段不出画面，画成文字块。 */
export type GalleryItem = {
  path: string;
  kindLabel: string;
  isImage: boolean;
};
export type GallerySection = SectionCommon & {
  kind: 'gallery';
  items: GalleryItem[];
};

export type ClipSection = SectionCommon & {
  kind: 'clip';
  source: string;
  /** 片段区间的展示写法（「12–18.5 秒」）。没有 clipRange 就没有这段。 */
  rangeLabel?: string;
};

export type DocumentSection = SectionCommon & {
  kind: 'document';
  source: string;
  /** 页数说明：没写 pages 是「翻全部页」，写了是「翻第 2、4 页」。 */
  pagesLabel: string;
};

export type OutroSection = SectionCommon & {
  kind: 'outro';
  subtitle?: string;
  lines: string[];
};

export type PageSection =
  | HeroSection
  | StructureSection
  | InventorySection
  | FileSection
  | GallerySection
  | ClipSection
  | DocumentSection
  | OutroSection;

export type PageModel = {
  /** 页面标题：讲稿 title > source.label > 目录名。 */
  title: string;
  /** 被讲解目录的展示名。 */
  label: string;
  /** 被讲解目录的绝对路径（讲稿 `source.root` 原样，页脚交代来源用）。 */
  sourceRoot: string;
  /** 第一个 cover 提升为页头 hero；区块里不再重复它。 */
  hero?: HeroSection;
  /** hero 之外的区块，按场景顺序。 */
  sections: PageSection[];
  /** 被跳过的场景（类型不认识）。 */
  skipped: { id: string; type: string }[];
  /** 引用的文件路径（相对源目录），按首次出现去重。图片内联与页脚清单都以它为准。 */
  references: string[];
};

/** 字节数：给人看的写法，保留一位小数。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 秒数展示：整数不带小数点，其余一位小数（「12–18.5 秒」）。 */
function formatSeconds(seconds: number): string {
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

/** 页码列表 → 「翻第 2、4 页」这样的说明。 */
export function describePages(pages: readonly number[] | undefined): string {
  if (pages === undefined || pages.length === 0) return '翻全部页';
  return `翻第 ${pages.join('、')} 页`;
}

const GALLERY_KIND_LABEL: Record<string, string> = {
  image: '图片',
  video: '视频',
  office: 'Office',
  pdf: 'PDF',
};

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/**
 * 讲稿 → 页面视图模型。
 *
 * 场景到区块的映射：cover→hero、tree→结构清单、inventory→分组盘点、file→文件卡片
 * （excerpt 进代码块）、gallery→图片网格、clip/document→卡片（本阶段不转封面/页图）、
 * outro→结尾小结。narration 一律保留，页面里当区块引文。
 */
export function collectViewModel(script: ScriptDocument): PageModel {
  const sourceRoot = script.source.root;
  const label = script.source.label ?? basename(sourceRoot.replace(/[\\/]+$/, ''));
  const title = script.title ?? label;

  const sections: PageSection[] = [];
  const skipped: { id: string; type: string }[] = [];
  const references: string[] = [];
  let hero: HeroSection | undefined;

  const reference = (path: string): void => {
    if (!references.includes(path)) references.push(path);
  };

  for (const scene of script.scenes) {
    switch (scene.type) {
      case 'cover': {
        const section: HeroSection = {
          kind: 'hero',
          id: scene.id,
          title: scene.title ?? title,
          ...(scene.subtitle === undefined ? {} : { subtitle: scene.subtitle }),
          narration: scene.narration,
        };
        // 第一个 cover 当页头；再出现就当普通区块画在正文里（讲稿允许，页面照画）
        if (hero === undefined) hero = section;
        else sections.push(section);
        break;
      }
      case 'tree': {
        const entries = scene.entries ?? [];
        const maxFiles = entries.reduce((max, entry) => Math.max(max, entry.files), 0);
        sections.push({
          kind: 'structure',
          id: scene.id,
          title: scene.title ?? '结构',
          narration: scene.narration,
          rows: entries.map((entry) => ({
            path: entry.path,
            files: entry.files,
            ...(entry.bytes === undefined ? {} : { bytesLabel: formatBytes(entry.bytes) }),
            share: maxFiles === 0 ? 0 : entry.files / maxFiles,
            highlight: entry.highlight === true,
          })),
        });
        break;
      }
      case 'inventory': {
        const groups = scene.groups ?? [];
        const total = scene.total ?? groups.reduce((sum, group) => sum + group.count, 0);
        sections.push({
          kind: 'inventory',
          id: scene.id,
          title: scene.title ?? '盘点',
          narration: scene.narration,
          total,
          rows: groups.map((group) => ({
            label: group.label,
            count: group.count,
            ...(group.note === undefined ? {} : { note: group.note }),
            share: total === 0 ? 0 : group.count / total,
          })),
        });
        break;
      }
      case 'file': {
        const file = scene.file ?? '';
        reference(file);
        sections.push({
          kind: 'file',
          id: scene.id,
          title: scene.title ?? basename(file),
          narration: scene.narration,
          file,
          ...(scene.note === undefined ? {} : { note: scene.note }),
          excerpt: scene.excerpt ?? [],
        });
        break;
      }
      case 'gallery': {
        const items = (scene.items ?? []).map((path) => {
          const kind = prepKindOf(path);
          return {
            path,
            kindLabel: (kind !== undefined ? GALLERY_KIND_LABEL[kind] : undefined) ?? '文件',
            isImage: kind === 'image',
          };
        });
        for (const item of items) reference(item.path);
        sections.push({
          kind: 'gallery',
          id: scene.id,
          title: scene.title ?? '图集',
          narration: scene.narration,
          items,
        });
        break;
      }
      case 'clip': {
        const source = scene.source ?? '';
        reference(source);
        sections.push({
          kind: 'clip',
          id: scene.id,
          title: scene.title ?? basename(source),
          narration: scene.narration,
          source,
          ...(scene.clipRange === undefined
            ? {}
            : { rangeLabel: `${formatSeconds(scene.clipRange[0] ?? 0)}–${formatSeconds(scene.clipRange[1] ?? 0)} 秒` }),
        });
        break;
      }
      case 'document': {
        const source = scene.source ?? '';
        reference(source);
        sections.push({
          kind: 'document',
          id: scene.id,
          title: scene.title ?? basename(source),
          narration: scene.narration,
          source,
          pagesLabel: describePages(scene.pages),
        });
        break;
      }
      case 'outro': {
        sections.push({
          kind: 'outro',
          id: scene.id,
          title: scene.title ?? '小结',
          ...(scene.subtitle === undefined ? {} : { subtitle: scene.subtitle }),
          narration: scene.narration,
          lines: scene.lines ?? [],
        });
        break;
      }
      default:
        // 开放枚举：不认识的类型跳过并记录（渲染入口的校验会把它们拦成 blocker）
        skipped.push({ id: scene.id, type: String((scene as Scene).type) });
        break;
    }
  }

  return {
    title,
    label,
    sourceRoot,
    ...(hero === undefined ? {} : { hero }),
    sections,
    skipped,
    references,
  };
}

/** 页脚要用的：视图模型里数一数区块（hero 不在 sections 里，单独算）。 */
export function countSections(model: PageModel): number {
  return model.sections.length + (model.hero === undefined ? 0 : 1);
}
