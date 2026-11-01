import { describe, expect, it } from 'vitest';
import { mapAgentSummaries } from '../src/shared/agentSummary';

// Shape captured from a live `opencode serve` v2.1.4 `/api/agent` response, already
// normalized by the v2 adapter (id/name/displayName/isPrimary/description).
const liveAgents = [
  { id: 'build', name: 'build', displayName: 'Build', isPrimary: true, description: 'The default agent.' },
  { id: 'general', name: 'general', displayName: 'General', isPrimary: false, description: '' },
  { id: 'explore', name: 'explore', displayName: 'Explore', isPrimary: false, description: '' },
  { id: 'plan', name: 'plan', displayName: 'Plan', isPrimary: true, description: '' }
];

describe('agent summary mapping', () => {
  it('keeps every primary agent the CLI lists, including plan', () => {
    expect(mapAgentSummaries(liveAgents)).toEqual([
      { name: 'build', isPrimary: true, displayName: 'Build', description: 'The default agent.' },
      { name: 'general', isPrimary: false, displayName: 'General' },
      { name: 'explore', isPrimary: false, displayName: 'Explore' },
      { name: 'plan', isPrimary: true, displayName: 'Plan' }
    ]);
  });

  it('passes custom agent presets through without a whitelist', () => {
    expect(
      mapAgentSummaries([
        ...liveAgents,
        { id: 'omo-oracle', name: 'omo-oracle', displayName: 'OMo Oracle', isPrimary: true, description: 'Preset' }
      ]).map((agent) => agent.name)
    ).toEqual(['build', 'general', 'explore', 'plan', 'omo-oracle']);
  });

  it('drops hidden, duplicated, and malformed entries', () => {
    expect(
      mapAgentSummaries([
        { id: 'build', isPrimary: true },
        { id: 'Build', isPrimary: true },
        { id: 'title', isPrimary: true, hidden: true },
        { id: '   ', isPrimary: true },
        { isPrimary: true },
        'nonsense',
        null
      ])
    ).toEqual([{ name: 'build', isPrimary: true }]);
  });

  it('treats a missing isPrimary flag as primary and tolerates a non-array payload', () => {
    expect(mapAgentSummaries([{ name: 'custom-agent' }])).toEqual([{ name: 'custom-agent', isPrimary: true }]);
    expect(mapAgentSummaries(undefined)).toEqual([]);
    expect(mapAgentSummaries({ data: [] })).toEqual([]);
  });
});
