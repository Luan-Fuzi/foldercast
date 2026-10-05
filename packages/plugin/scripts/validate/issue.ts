/**
 * 校验结果的问题模型。
 *
 * 判据（编码进 `code`）与呈现（`message` / `fix`）分开：编码是稳定接口，M4 的工具与 CI
 * 按它做判断；给人看的是后两个。**每条问题都必须能指到具体位置**（文件 + 行号 + 字段，
 * 讲稿里再带上场景 id），否则写稿的 agent 拿到的是一句「有地方错了」。
 */
import type { Scene } from '../contracts/script.ts';

/**
 * `blocker` 必须修，`warning` 可能是笔误。
 *
 * 不设 `info`：契约校验里没有「仅供参考」这一档，凡是查出来但不必改的都不该报。
 */
export type IssueSeverity = 'blocker' | 'warning';

export type IssueCode =
  // ── JSON 与 schema ──────────────────────────────
  /** 文件不存在。 */
  | 'missing-file'
  /** 文件不是合法 JSON。 */
  | 'json-invalid'
  /** JSON Schema 校验失败。 */
  | 'schema'
  /** 解读或讲稿的 `foldercast` 版本不是本工具支持的版本。 */
  | 'version-unsupported'
  // ── 解读内部自洽 ────────────────────────────────
  | 'stats-mismatch'
  | 'graph-mismatch'
  /** 统计里提到的路径不在 manifest 里。 */
  | 'stats-path-missing'
  /** `source.root` 不是绝对路径。 */
  | 'source-root-relative'
  /** `source.label` 与目录名不一致（默认行为就是目录名）。 */
  | 'label-mismatch'
  // ── 讲稿引用的路径 ──────────────────────────────
  /** 分镜引用了 `manifest` 里不存在的路径（幻觉路径）。 */
  | 'path-hallucinated'
  /** 素材路径既不在素材清单里，也不在工作根下。 */
  | 'asset-missing'
  /** 场景缺该类型必需的字段。 */
  | 'scene-field-missing'
  /** 场景出现了该类型用不上的字段。 */
  | 'scene-field-unused'
  // ── 讲稿自身的自洽 ──────────────────────────────
  /** `scene.id` 重复。 */
  | 'scene-id-duplicate'
  /** 字幕块超长，切不出合规的字幕。 */
  | 'subtitle-too-long'
  /** 场景 `type` 不认识。 */
  | 'scene-type-unknown'
  /** 讲稿的 `source.root` 与解读不一致。 */
  | 'source-root-mismatch'
  | 'inventory-group-count-mismatch'
  | 'inventory-group-kind-unknown'
  /** `focusLines` 超出文件的真实行数。 */
  | 'focus-lines-out-of-range'
  | 'clip-range-invalid';

export type Issue = {
  /** 问题所在文件（路径按调用方给的写法，便于阅读）。 */
  path: string;
  /** 问题所在的 JSON 指针，如 `/scenes/2/file`。根对象为 `/`。 */
  pointer: string;
  severity: IssueSeverity;
  code: IssueCode;
  /** 人读的一句话，说清「哪里、什么、期望什么」。 */
  message: string;
  /** 可操作的一句话：怎么改。 */
  fix?: string;
  /** 讲稿问题带上场景 id，人一眼能定位。 */
  sceneId?: string;
  /** 讲稿问题带上字段名，列表里可以只显示字段。 */
  field?: string;
  /** 在文件里的位置，1 起。 */
  at?: { line: number; column: number };
};

export type SeverityCounts = { blocker: number; warning: number };

/** 收集问题并保持稳定顺序（按文件、再按位置）。 */
export class IssueCollector {
  private readonly issues: Issue[] = [];

  add(issue: Issue): void {
    this.issues.push(issue);
  }

  /** 已经收集了多少条。用于「检查了 N 个文件」这类摘要。 */
  get size(): number {
    return this.issues.length;
  }

  counts(): SeverityCounts {
    return {
      blocker: this.issues.filter((issue) => issue.severity === 'blocker').length,
      warning: this.issues.filter((issue) => issue.severity === 'warning').length,
    };
  }

  all(): Issue[] {
    return [...this.issues];
  }

  /** 排序键：文件 → 行号 → 指针。没有行号（如整份文件级别）的排在同文件最前。 */
  sorted(): Issue[] {
    return [...this.issues].sort((left, right) => {
      if (left.path !== right.path) return left.path < right.path ? -1 : 1;
      const leftLine = left.at?.line ?? 0;
      const rightLine = right.at?.line ?? 0;
      if (leftLine !== rightLine) return leftLine - rightLine;
      return left.pointer < right.pointer ? -1 : left.pointer > right.pointer ? 1 : 0;
    });
  }
}

/** 场景在 `scenes` 里的指针，如 `/scenes/3`。 */
export function scenePointer(index: number): string {
  return `/scenes/${String(index)}`;
}

/** 场景里某个字段的指针。 */
export function fieldPointer(index: number, field: string): string {
  return `${scenePointer(index)}/${field}`;
}

/** 从场景数组下标与字段生成「场景 id + 字段」的展示片段。 */
export function sceneLabel(scene: Scene | undefined, index: number): string {
  const id = scene?.id;
  return id === undefined || id === '' ? `第 ${String(index + 1)} 个场景` : `场景 ${id}`;
}
