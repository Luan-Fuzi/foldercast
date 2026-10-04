#!/usr/bin/env python3
"""检查 Markdown 文档里的相对链接是否指向存在的文件。

用法：
    python3 scripts/check-links.py          # 检查，有失效则退出码 1
    python3 scripts/check-links.py -v       # 打印所有检查过的链接

这是 docs/conventions/docs.md 里那条规范的可执行版本：文档重组后必须跑。
"""
from __future__ import annotations

import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "out", "assets"}
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")


def iter_markdown() -> list[pathlib.Path]:
    files = []
    for p in ROOT.rglob("*.md"):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        files.append(p)
    return sorted(files)


def check(verbose: bool = False) -> int:
    broken: list[tuple[pathlib.Path, int, str]] = []
    total = 0

    for md in iter_markdown():
        text = md.read_text(encoding="utf-8")
        for lineno, line in enumerate(text.splitlines(), start=1):
            for m in LINK_RE.finditer(line):
                target = m.group(1).strip()
                # 跳过外链、锚点、mailto
                if target.startswith(("http://", "https://", "#", "mailto:")):
                    continue
                path_part = target.split("#", 1)[0]
                if not path_part:
                    continue
                total += 1
                resolved = (md.parent / path_part).resolve()
                if resolved.exists():
                    if verbose:
                        rel = md.relative_to(ROOT)
                        print(f"  ok   {rel}:{lineno}  ->  {target}")
                else:
                    broken.append((md.relative_to(ROOT), lineno, target))

    print(f"检查了 {total} 条相对链接，覆盖 {len(iter_markdown())} 个文档。")
    if broken:
        print(f"\n发现 {len(broken)} 条失效链接：")
        for rel, lineno, target in broken:
            print(f"  {rel}:{lineno}  ->  {target}")
        return 1
    print("全部有效 ✓")
    return 0


if __name__ == "__main__":
    raise SystemExit(check(verbose="-v" in sys.argv))
