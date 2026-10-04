import { describe, expect, it } from 'vitest';
import { matchSecretFilename } from '../secrets.ts';

describe('密钥文件名判据', () => {
  it('命中默认清单里的模式', () => {
    const cases: Array<[string, string]> = [
      ['.env', '.env'],
      ['.env.local', '.env.*'],
      ['prod.env', '*.env'],
      ['credentials.json', 'credentials.json'],
      ['secrets.json', 'secrets.json'],
      ['.netrc', '.netrc'],
      ['server.pem', '*.pem'],
      ['private.key', '*.key'],
      ['cert.p12', '*.p12'],
      ['app.keystore', '*.keystore'],
      ['id_rsa', 'id_rsa'],
      ['.mimo_api_key', '.*_key'],
      ['prod_api_key', '*_api_key'],
      ['github_token', '*_token'],
      ['db_secret', '*_secret'],
    ];
    for (const [filename, expected] of cases) {
      const verdict = matchSecretFilename(filename);
      expect(verdict.secret, filename).toBe(true);
      if (verdict.secret) expect(verdict.match, filename).toBe(expected);
    }
  });

  it('不误伤正常文件名', () => {
    for (const filename of [
      'environment.md',
      'keynotes.md',
      'tokenizer.ts',
      'monkey.png',
      'secretary.txt',
      'keys.json',
      'README.md',
      '.gitignore',
      'api-keys.md',
    ]) {
      expect(matchSecretFilename(filename).secret, filename).toBe(false);
    }
  });

  it('大小写不敏感', () => {
    expect(matchSecretFilename('.ENV').secret).toBe(true);
    expect(matchSecretFilename('Server.PEM').secret).toBe(true);
  });
});
