import { describe, expect, it } from 'vitest';
import { detectRole } from '../roles.ts';

describe('角色识别', () => {
  it('README 与许可证，任意层级', () => {
    expect(detectRole('README.md', 'text')).toBe('readme');
    expect(detectRole('docs/README.md', 'text')).toBe('readme');
    expect(detectRole('LICENSE', 'text')).toBe('license');
    expect(detectRole('COPYING', 'text')).toBe('license');
  });

  it('入口：常见入口文件名与项目清单', () => {
    expect(detectRole('src/index.ts', 'code')).toBe('entry');
    expect(detectRole('src/Root.tsx', 'code')).toBe('entry');
    expect(detectRole('main.py', 'code')).toBe('entry');
    expect(detectRole('package.json', 'data')).toBe('entry');
    expect(detectRole('Cargo.toml', 'data')).toBe('entry');
  });

  it('package.json 是入口而不是配置（优先级）', () => {
    expect(detectRole('package.json', 'data')).toBe('entry');
    expect(detectRole('tsconfig.json', 'data')).toBe('config');
    expect(detectRole('remotion.config.ts', 'code')).toBe('config');
    expect(detectRole('.eslintrc.json', 'data')).toBe('config');
  });

  it('测试：文件名约定与测试目录', () => {
    expect(detectRole('src/util.test.ts', 'code')).toBe('test');
    expect(detectRole('src/util.spec.ts', 'code')).toBe('test');
    expect(detectRole('tests/helper.py', 'code')).toBe('test');
    expect(detectRole('pkg/handler_test.go', 'code')).toBe('test');
  });

  it('docs/specs 下的是文档不是测试（回归）', () => {
    expect(detectRole('docs/specs/thing.md', 'text')).toBe('doc');
    expect(detectRole('docs/specs/x.schema.json', 'data')).toBe('doc');
    // Ruby 风格的 spec/ 仍然是测试目录
    expect(detectRole('spec/models/user_spec.rb', 'code')).toBe('test');
  });

  it('构建：构建脚本、CI 与产物目录', () => {
    expect(detectRole('Makefile', 'code')).toBe('build');
    expect(detectRole('Dockerfile', 'code')).toBe('build');
    expect(detectRole('.github/workflows/check.yml', 'data')).toBe('build');
    expect(detectRole('dist/bundle.js', 'code')).toBe('build');
  });

  it('素材与文档按类型判定', () => {
    expect(detectRole('assets/logo.png', 'image')).toBe('asset');
    expect(detectRole('public/app.js', 'code')).toBe('asset');
    expect(detectRole('docs/guide.md', 'text')).toBe('doc');
    expect(detectRole('report.docx', 'office')).toBe('doc');
  });

  it('判定不了就缺省', () => {
    expect(detectRole('src/util.ts', 'code')).toBeUndefined();
    expect(detectRole('packages/plugin/.gitkeep', 'other')).toBeUndefined();
  });
});
