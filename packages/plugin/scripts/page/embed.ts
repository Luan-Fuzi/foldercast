/**
 * 图片内联：讲稿引用的图片文件 → 页面里能直接用的 `src`。
 *
 * 页面要能整份转发，所以默认把图片缩到页面尺寸（sips 优先、ffmpeg 回退，最长边 560、
 * JPEG q70）再内联成 data URI；**mime 跟实际字节走** —— 缩小产物是 JPEG，哪怕源文件是
 * PNG，data URI 也必须声明 JPEG（M6 踩过的坑：浏览器能容错，但那是错的）。
 *
 * 两层预算：单张超过 `perImageLimitBytes`、或内联总量超过 `totalBudgetBytes`，就退回
 * 相对路径并**在页脚说明**（页面自己交代边界，不悄悄引用外部文件）。缩放与内联的本体
 * 复用渲染器的 `embedImage`（`renderer/embed-node.ts`）：同一套缩图命令、同一个
 * 魔数嗅探，页面与视频不各养一份。
 *
 * 非图片引用（office / pdf / 视频 / 文本）不进这里：本阶段只出卡片，不做转换。
 */
import { relative, resolve } from 'node:path';
import { prepKindOf } from '../contracts/prep.ts';
import { embedImage, isImagePath } from '../renderer/embed-node.ts';

/** 一个引用在页面里的落点：内联的 data URI，或退回的相对路径（相对页面所在目录）。 */
export type PageImage = {
  src: string;
  inlined: boolean;
  /** 内联时的字节 数（相对路径时没有）。 */
  bytes?: number;
  /** 退回相对路径的原因，给页脚说明与测试断言用。 */
  reason?: string;
};

export type PageEmbedReport = {
  /** 引用路径（相对源目录）→ 落点。只有能当图片用的引用才会出现在这里。 */
  images: Map<string, PageImage>;
  /** 给页脚的说明（哪几张没内联、为什么）。 */
  notes: string[];
  inlined: number;
  linked: number;
  /** 内联进页面的总字节。 */
  inlineBytes: number;
};

export type EmbedPageOptions = {
  /** 源目录：讲稿引用的路径相对它。 */
  sourceDir: string;
  /** 页面所在目录：相对路径以它为基准（`<目录>/.foldercast/out`）。 */
  outDir: string;
  /** 缩小后的最长边。页面里缩略图最大显示到 320px（CSS），560 留了高倍屏余量。 */
  maxWidth?: number;
  /** JPEG 质量。 */
  quality?: number;
  /** 单张超过这个字节数就退相对路径。 */
  perImageLimitBytes?: number;
  /** 内联总量超过这个字节数，之后的都退相对路径。 */
  totalBudgetBytes?: number;
  /** 测试注入口：替换真实的缩放/内联实现。 */
  embed?: typeof embedImage;
};

/** 缩放后仍不适合放进单个文件的尺寸（与 M6 的经验值一致：密集图 560/q70 约 60–90 KB）。 */
export const DEFAULT_PER_IMAGE_LIMIT = 160 * 1024;

/** 单页内联总预算：页面整份转发时别超过一张手机照片的体量。 */
export const DEFAULT_TOTAL_BUDGET = 1536 * 1024;

function kb(bytes: number): string {
  return `${String(Math.round(bytes / 1024))} KB`;
}

/** 页面到源文件的相对路径（POSIX 分隔符，页面上 `src="../../assets/x.png"` 这么写）。 */
export function relativeSrc(outDir: string, absolute: string): string {
  return relative(resolve(outDir), resolve(absolute)).split(/[\\/]/).join('/');
}

/**
 * 解析一批图片引用。输入应当是去重后的引用清单（`collect.ts` 的 `references`），
 * 非图片的引用直接忽略（调用方按卡片处理）。
 */
export function embedPageImages(
  refs: readonly string[],
  options: EmbedPageOptions,
): PageEmbedReport {
  const sourceDir = resolve(options.sourceDir);
  const outDir = resolve(options.outDir);
  const maxWidth = options.maxWidth ?? 560;
  const quality = options.quality ?? 70;
  const perImageLimit = options.perImageLimitBytes ?? DEFAULT_PER_IMAGE_LIMIT;
  const totalBudget = options.totalBudgetBytes ?? DEFAULT_TOTAL_BUDGET;
  const doEmbed = options.embed ?? embedImage;

  const images = new Map<string, PageImage>();
  const notes: string[] = [];
  let inlined = 0;
  let linked = 0;
  let inlineBytes = 0;
  let budgetExhausted = false;

  for (const ref of [...new Set(refs)]) {
    if (!isImagePath(ref)) {
      // HEIC / TIFF 这类「是图片、浏览器却显示不了 data URI」的格式也交代一句，
      // 不然页脚统计与页面上的空卡片对不上数
      if (prepKindOf(ref) === 'image') {
        notes.push(`${ref}：这种图片格式（HEIC/TIFF 一类）浏览器内联不了，页面上按文件卡片处理。`);
      }
      continue;
    }

    const fallback = (reason: string): void => {
      const src = relativeSrc(outDir, resolve(sourceDir, ref));
      images.set(ref, { src, inlined: false, reason });
      linked += 1;
      notes.push(`${ref}：${reason}，页面按相对路径引用（转发时要把源文件一起带上）。`);
    };

    if (budgetExhausted) {
      fallback(`内联总预算（${kb(totalBudget)}）已用完`);
      continue;
    }

    const embedded = doEmbed({ path: ref, workRoot: sourceDir, width: maxWidth, quality });
    if (embedded === undefined) {
      // embedImage 只在「文件不存在 / 不是图片 / 超过 12MB」时返回 undefined；
      // 前两种不会走到这（调用方筛过、校验拦过），所以按「太大」处理
      fallback(`缩不小或超过内联上限（${kb(12 * 1024 * 1024)}）`);
      continue;
    }

    if (embedded.bytes > perImageLimit) {
      fallback(`单张 ${kb(embedded.bytes)} 超过预算 ${kb(perImageLimit)}`);
      continue;
    }

    if (inlineBytes + embedded.bytes > totalBudget) {
      budgetExhausted = true;
      fallback(`加上它就超出内联总预算（${kb(totalBudget)}）`);
      continue;
    }

    images.set(ref, { src: embedded.src, inlined: true, bytes: embedded.bytes });
    inlined += 1;
    inlineBytes += embedded.bytes;
    // 缩图工具缺席时会内联原图（体积偏大）：把这个事实也说给页脚
    if (embedded.note !== undefined) notes.push(`${ref}：${embedded.note}`);
  }

  return { images, notes, inlined, linked, inlineBytes };
}
