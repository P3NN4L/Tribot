import crypto from 'node:crypto';

// ===== 凭证加密（AES-256-GCM）=====
// 主密钥由 Electron 用系统 DPAPI（safeStorage）加密后存在 data/.masterkey，
// 启动时解密并通过 TRIBOT_MASTER_KEY 传给 server 子进程。
// 没有主密钥时（纯命令行开发模式）退化为明文，行为与旧版一致。

const PREFIX = 'enc:v1:';

export function masterKeyFromEnv(): Buffer | null {
  const raw = process.env.TRIBOT_MASTER_KEY;
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64');
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

export function isEncryptedSecret(value?: string | null): boolean {
  return !!value && value.startsWith(PREFIX);
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(blob: string, key: Buffer): string {
  if (!isEncryptedSecret(blob)) return blob;
  const parts = blob.slice(PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('密文格式不对');
  const [ivB64, tagB64, ctB64] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
