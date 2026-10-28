// ===== 自定义皮肤：用户上传一张图，存本地，渲染层当背景 =====

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export const MAX_SKIN_BYTES = 6 * 1024 * 1024;

export interface ParsedSkin {
  ext: string;
  buffer: Buffer;
}

/**
 * 解析 data URL。只接受 PNG / JPEG / WebP，限制 6MB。
 * 不信任扩展名，只看 data URL 里的 MIME。
 */
export function parseSkinDataUrl(input: string): ParsedSkin {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(input ?? '').trim());
  if (!m) throw new Error('只支持 PNG / JPEG / WebP 图片');
  const ext = MIME_EXT[m[1]];
  const buffer = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (buffer.length === 0) throw new Error('图片内容为空');
  if (buffer.length > MAX_SKIN_BYTES) throw new Error('图片太大（上限 6MB）');
  return { ext, buffer };
}

export function skinContentType(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

/** 只允许 data/skins 下的纯文件名，防路径穿越 */
export function safeSkinName(file: string): string | null {
  const name = String(file ?? '').trim();
  if (!/^[a-z0-9._-]{1,64}$/i.test(name)) return null;
  if (name.includes('..')) return null;
  return name;
}
