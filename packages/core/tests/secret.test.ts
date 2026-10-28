import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../src/secret.js';

describe('AES-256-GCM 凭证加密', () => {
  const key = crypto.randomBytes(32);

  it('往返一致（含中文与特殊字符）', () => {
    const plain = 'sk-测试-key-!@#$%^&*()_+{}|:"<>?';
    const blob = encryptSecret(plain, key);
    expect(isEncryptedSecret(blob)).toBe(true);
    expect(blob).not.toContain(plain);
    expect(decryptSecret(blob, key)).toBe(plain);
  });

  it('密文被篡改会抛错（GCM 校验）', () => {
    const blob = encryptSecret('secret', key);
    const tampered = blob.slice(0, -4) + (blob.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it('不同密钥解不开', () => {
    const blob = encryptSecret('secret', key);
    expect(() => decryptSecret(blob, crypto.randomBytes(32))).toThrow();
  });
});
