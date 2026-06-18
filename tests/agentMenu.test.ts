import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('composer agent menu', () => {
  it('renders a collapsible agent menu from the backend agent list', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8');

    expect(source).toContain('function AgentMenu');
    expect(source).toContain('agents: AgentSummary[]');
    expect(source).toContain('getVisibleAgentOptions(agents, selectedAgent)');
    expect(source).toContain('for (const agent of agents)');
    expect(source).toContain('<AgentMenu');
    expect(source).toContain('agents={agents}');
    expect(source).toContain('role="listbox" aria-label="agent mode"');
    expect(source).toContain('role="option"');
    expect(source).toContain('onSelect(agent.name)');
    expect(source).not.toContain('className="agent-toggle"');
    expect(source).not.toContain("onClick={() => setSelectedAgent('build')}");
    expect(source).not.toContain("onClick={() => setSelectedAgent('plan')}");
  });

  it('hides opencode internal agents while keeping build, plan, and custom agents selectable', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8');

    expect(source).toContain("const VISIBLE_BUILTIN_AGENT_NAMES = new Set(['build', 'plan'])");
    expect(source).toContain("const HIDDEN_BUILTIN_AGENT_NAMES = new Set(['compaction', 'explore', 'general', 'summary', 'title'])");
    expect(source).toContain('!HIDDEN_BUILTIN_AGENT_NAMES.has(normalized)');
    expect(source).toContain('VISIBLE_BUILTIN_AGENT_NAMES.has(normalized) || agents.some');
    expect(source).toContain('isVisibleAgentSelection(message.payload.agents, current)');
    expect(source).toContain('getDefaultAgentName(message.payload.agents)');
    expect(source).not.toContain('selectedOption?.isPrimary');
    expect(source).not.toContain('agent-menu__primaryDot');
    expect(source).not.toContain('agent-menu__badge');
  });

  it('styles the agent selector as a compact folding menu instead of fixed tabs', () => {
    const styles = readFileSync(join(root, 'webview-ui/src/styles.css'), 'utf8');

    expect(styles).toContain('.agent-menu');
    expect(styles).toContain('.agent-menu__summary');
    expect(styles).toContain('.agent-menu__panel');
    expect(styles).toContain('.agent-menu__option');
    expect(styles).toContain('bottom: calc(100% + 0.38rem);');
    expect(styles).toContain('flex: 0 1 7rem;');
    expect(styles).toContain('width: min(10rem, calc(100vw - 1.2rem));');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(styles).not.toContain('.agent-menu__primaryDot');
    expect(styles).not.toContain('.agent-menu__badge');
    expect(styles).not.toContain('.agent-toggle__btn--build');
    expect(styles).not.toContain('.agent-toggle__btn--plan');
  });
});
