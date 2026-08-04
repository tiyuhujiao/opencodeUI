import { describe, expect, it } from 'vitest';
import {
  appendWorkspaceMentions,
  getWorkspaceMentionState,
  hasWorkspaceMention,
  insertWorkspaceMention,
  mergeWorkspaceResources
} from '../webview-ui/src/workspaceMentions';

const appFile = { kind: 'file' as const, path: 'webview-ui/src/App.tsx', absolutePath: 'E:\\opencodeUI\\webview-ui\\src\\App.tsx' };
const spacedFolder = { kind: 'folder' as const, path: 'docs/design notes/', absolutePath: 'E:\\opencodeUI\\docs\\design notes' };

describe('workspace mentions', () => {
  it('识别光标处 @ 查询并替换为选中的工作区文件', () => {
    const value = 'Review @App';
    const state = getWorkspaceMentionState(value, value.length);
    expect(state?.query).toBe('App');
    expect(insertWorkspaceMention(value, state!, appFile)).toEqual({
      value: 'Review @webview-ui/src/App.tsx ',
      cursor: 31
    });
  });

  it('为带空格的目录加引号并合并拖拽资源去重', () => {
    const inserted = appendWorkspaceMentions('Inspect', [spacedFolder]);
    expect(inserted.value).toBe('Inspect @"docs/design notes/" ');
    expect(hasWorkspaceMention(inserted.value, spacedFolder)).toBe(true);
    expect(mergeWorkspaceResources([appFile], [appFile, spacedFolder])).toEqual([appFile, spacedFolder]);
  });
});
