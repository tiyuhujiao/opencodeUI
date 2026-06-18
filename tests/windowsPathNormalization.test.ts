import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

vi.mock('vscode', () => ({}), { virtual: true });

import { buildPromptParts, detectImageMimeType, normalizePromptFilePath } from '../src/webview/SidebarProvider';

describe('normalizePromptFilePath', () => {
  it('将 wsl.localhost 与 wsl$ UNC 路径转换为 WSL 可读路径', () => {
    expect(normalizePromptFilePath('\\\\wsl.localhost\\Ubuntu-20.04\\home\\ww\\demo\\file.pdf', 'wsl')).toBe('/home/ww/demo/file.pdf');
    expect(normalizePromptFilePath('\\\\wsl$\\Ubuntu-20.04\\home\\ww\\demo\\file.pdf', 'wsl')).toBe('/home/ww/demo/file.pdf');
  });

  it('Linux 与 Remote-SSH Linux 使用 POSIX 路径，并拒绝 Windows 路径', () => {
    expect(normalizePromptFilePath('/home/ww/demo/../file.pdf', 'local-linux')).toBe('/home/ww/file.pdf');
    expect(normalizePromptFilePath('/srv/project/file.pdf', 'remote-ssh-linux')).toBe('/srv/project/file.pdf');
    expect(normalizePromptFilePath('/workspace/file.pdf', 'remote-linux')).toBe('/workspace/file.pdf');

    expect(() => normalizePromptFilePath('C:\\Users\\ww\\file.pdf', 'local-linux')).toThrow(/无法直接读取 Windows 路径/);
    expect(() => normalizePromptFilePath('\\\\server\\share\\file.pdf', 'remote-ssh-linux')).toThrow(/无法直接读取 Windows 路径/);
  });

  it('Windows 本机按 Windows 路径生成规范 file URL', () => {
    expect(buildPromptParts('看图', ['C:\\Users\\ww\\Pictures\\pasted image.png'], 'local-windows')).toEqual([
      {
        type: 'file',
        url: 'file:///C:/Users/ww/Pictures/pasted%20image.png',
        filename: 'pasted image.png',
        mime: 'image/png'
      },
      {
        type: 'text',
        text: '看图'
      }
    ]);
  });

  it('Linux 图片 prompt part 使用宿主可读 file URL', () => {
    expect(buildPromptParts('看图', ['/tmp/pasted.png'], 'local-linux')).toEqual([
      {
        type: 'file',
        url: 'file:///tmp/pasted.png',
        filename: 'pasted.png',
        mime: 'image/png'
      },
      {
        type: 'text',
        text: '看图'
      }
    ]);
  });

  it('可识别 PNG/JPEG/GIF/WebP 图片头', () => {
    expect(detectImageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectImageMimeType(Buffer.from('GIF89a', 'ascii'))).toBe('image/gif');
    expect(detectImageMimeType(Buffer.from('RIFFxxxxWEBP', 'ascii'))).toBe('image/webp');
    expect(detectImageMimeType(Buffer.from('not-image', 'ascii'))).toBeNull();
  });
});
