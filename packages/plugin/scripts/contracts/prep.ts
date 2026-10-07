/**
 * 素材 prep 的类型：讲稿引用的源文件 → 可供渲染的画面产物。
 *
 * prep 是**按需**的：只转换讲稿点名的文件（图片缩略图、视频封面、Office/PDF 逐页图与
 * 全文 Markdown），按 `mtime + size` 缓存在 `<工作根>/assets/` 下。没有全局清单 ——
 * 讲稿就是清单。
 */

/** 会做转换的源文件类别（按扩展名判断，不猜内容）。 */
export type PrepKind = 'image' | 'video' | 'office' | 'pdf';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.heic', '.tiff']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v']);
const OFFICE_EXT = new Set(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp']);
const PDF_EXT = new Set(['.pdf']);

/** 按扩展名认类别。认不出（文本、代码、音频…）返回 undefined —— 那些不需要转换。 */
export function prepKindOf(path: string): PrepKind | undefined {
  const dot = path.lastIndexOf('.');
  const ext = dot === -1 ? '' : path.slice(dot).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (OFFICE_EXT.has(ext)) return 'office';
  if (PDF_EXT.has(ext)) return 'pdf';
  return undefined;
}

/** 一件画面产物。`path` 相对工作根（`assets/…`）。 */
export type PrepProduct = {
  role: 'thumb' | 'poster' | 'page';
  path: string;
  width?: number;
  height?: number;
};

/** 一个源文件的 prep 结果。 */
export type Prepared = {
  kind: PrepKind;
  /** 相对源目录的路径，即讲稿里引用时写的那个。 */
  source: string;
  products: PrepProduct[];
  /** office / pdf 的页数。 */
  pageCount?: number;
  /** 提取出的全文 Markdown（相对工作根），office / pdf 才有。 */
  markdown?: string;
  /** 部分失败的原因（比如缺 dsoffice：页图转不出来，但文本已提取）。 */
  error?: string;
};

/** 供条形图 / 封面用的主产物：图片取缩略图，视频取封面，文档取第一页。 */
export function primaryOf(prepared: Prepared | undefined): PrepProduct | undefined {
  if (prepared === undefined) return undefined;
  const order: PrepProduct['role'][] = ['thumb', 'poster', 'page'];
  for (const role of order) {
    const hit = prepared.products.find((product) => product.role === role);
    if (hit !== undefined) return hit;
  }
  return undefined;
}
