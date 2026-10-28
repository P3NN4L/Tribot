import { describe, expect, it } from 'vitest';
import { parseSkinDataUrl, safeSkinName, skinContentType } from '../src/skin.js';

// 皮肤上传：只认 PNG/JPEG/WebP 的 base64 data URL，文件名只允许纯文件名

describe('皮肤图片解析', () => {
  it('接受 PNG / JPEG / WebP', () => {
    const png = parseSkinDataUrl('data:image/png;base64,iVBORw0KGgo=');
    expect(png.ext).toBe('png');
    expect(png.buffer.length).toBeGreaterThan(0);
    expect(parseSkinDataUrl('data:image/jpeg;base64,/9j/4AAQ').ext).toBe('jpg');
    expect(parseSkinDataUrl('data:image/webp;base64,UklGRg==').ext).toBe('webp');
  });

  it('拒绝 SVG、GIF 和空内容', () => {
    expect(() => parseSkinDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toThrow('只支持');
    expect(() => parseSkinDataUrl('data:image/gif;base64,R0lGODlh')).toThrow('只支持');
    expect(() => parseSkinDataUrl('')).toThrow('只支持');
    expect(() => parseSkinDataUrl('data:image/png;base64,')).toThrow('只支持');
    expect(() => parseSkinDataUrl('data:image/png;base64,AAAA')).not.toThrow();
  });

  it('文件名必须是纯文件名，防路径穿越', () => {
    expect(safeSkinName('current.png')).toBe('current.png');
    expect(safeSkinName('../secret.png')).toBeNull();
    expect(safeSkinName('..\\x.png')).toBeNull();
    expect(safeSkinName('/etc/passwd')).toBeNull();
  });

  it('content-type 按扩展名映射', () => {
    expect(skinContentType('a.png')).toBe('image/png');
    expect(skinContentType('a.jpg')).toBe('image/jpeg');
    expect(skinContentType('a.webp')).toBe('image/webp');
    expect(skinContentType('a.bin')).toBe('application/octet-stream');
  });
});
