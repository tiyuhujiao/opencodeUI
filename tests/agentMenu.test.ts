import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getAgentLabel,
  getDefaultAgentName,
  getSelectableAgents,
  getVisibleAgentOptions,
  isSelectableAgentSelection
} from '../webview-ui/src/agentOptions';
import type { AgentSummary } from '../src/shared/protocol';

const root = process.cwd();

const cliAgents: AgentSummary[] = [
  { name: 'build', isPrimary: true, displayName: 'Build' },
  { name: 'plan', isPrimary: true, displayName: 'Plan' },
  { name: 'omo-oracle', isPrimary: true, description: 'Preset agent installed by omo' },
  { name: 'general', isPrimary: false },
  { name: 'explore', isPrimary: false },
  { name: 'title', isPrimary: true, hidden: true }
];

describe('composer agent menu', () => {
  it('renders a collapsible agent menu from the backend agent list', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8');

    expect(source).toContain('function AgentMenu');
    expect(source).toContain('agents: AgentSummary[]');
    expect(source).toContain('getVisibleAgentOptions(agents, selectedAgent)');
    expect(source).toContain('getSelectableAgents(agents)');
    expect(source).toContain('<AgentMenu');
    expect(source).toContain('agents={agents}');
    expect(source).toContain('role="listbox" aria-label="agent mode"');
    expect(source).toContain('role="option"');
    expect(source).toContain('onSelect(agent.name)');
    expect(source).not.toContain('className="agent-toggle"');
    expect(source).not.toContain("onClick={() => setSelectedAgent('build')}");
    expect(source).not.toContain("onClick={() => setSelectedAgent('plan')}");
  });

  it('mirrors the CLI picker instead of hardcoding agent names', () => {
    expect(getSelectableAgents(cliAgents).map((agent) => agent.name)).toEqual([
      'build',
      'plan',
      'omo-oracle'
    ]);

    const appSource = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8');
    expect(appSource).not.toContain('VISIBLE_BUILTIN_AGENT_NAMES');
    expect(appSource).not.toContain('HIDDEN_BUILTIN_AGENT_NAMES');
    expect(appSource).not.toContain('agent-menu__primaryDot');
    expect(appSource).not.toContain('agent-menu__badge');
  });

  it('keeps agent presets installed later (e.g. by omo) selectable as soon as the server reports them', () => {
    const withPreset: AgentSummary[] = [
      ...cliAgents,
      { name: 'omo-reviewer', isPrimary: true, displayName: 'OMo Reviewer' }
    ];

    expect(isSelectableAgentSelection(withPreset, 'omo-reviewer')).toBe(true);
    expect(isSelectableAgentSelection(withPreset, 'omo-oracle')).toBe(true);
    expect(isSelectableAgentSelection(withPreset, 'general')).toBe(false);
    expect(isSelectableAgentSelection(withPreset, 'title')).toBe(false);
    expect(getVisibleAgentOptions(withPreset).map((agent) => agent.name)).toEqual([
      'build',
      'plan',
      'omo-oracle',
      'omo-reviewer'
    ]);
  });

  it('defaults to build, falls back to the first primary agent, and keeps the current selection visible', () => {
    expect(getDefaultAgentName(cliAgents)).toBe('build');
    expect(getDefaultAgentName([{ name: 'omo-oracle', isPrimary: true }])).toBe('omo-oracle');
    expect(getDefaultAgentName([])).toBe('build');

    expect(getVisibleAgentOptions(cliAgents, 'omo-oracle').map((agent) => agent.name)[0]).toBe('omo-oracle');
    expect(getVisibleAgentOptions(cliAgents, 'custom-agent').map((agent) => agent.name)).toEqual([
      'custom-agent',
      'build',
      'plan',
      'omo-oracle'
    ]);
  });

  it('shows the server display name but runs the agent id', () => {
    expect(getAgentLabel({ name: 'omo-oracle', isPrimary: true, displayName: 'OMo Oracle' })).toBe('OMo Oracle');
    expect(getAgentLabel({ name: 'omo-oracle', isPrimary: true, displayName: '  ' })).toBe('omo-oracle');
    expect(getAgentLabel({ name: 'plan', isPrimary: true })).toBe('plan');
  });

  it('filters the /agent dialog with the same rules', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/dialog/ResourceDialog.tsx'), 'utf8');

    expect(source).toContain('getSelectableAgents(props.agents)');
    expect(source).toContain('getAgentLabel(agent)');
    expect(source).not.toContain('props.agents.map((agent)');
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
