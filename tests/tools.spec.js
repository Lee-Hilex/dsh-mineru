import { describe, it, expect, vi } from 'vitest';

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: (def) => def,
}));

import { ACTIVATE_TOOL_NAME, TOOL_NAMES, buildActivateTool, buildAgentTools } from '../lib/tools.js';

function makeState() {
  return {
    activatedAgents: new WeakSet(),
    agentToolDefs: [],
    getCfg: () => ({ mode: 'auto', modelVersion: 'vlm', language: 'ch' }),
  };
}

describe('tool registry shape', () => {
  it('buildActivateTool registers the bootstrap tool', () => {
    const def = buildActivateTool(makeState());
    expect(def.name).toBe(ACTIVATE_TOOL_NAME);
    expect(def.name).toBe('mineru_activate');
    expect(typeof def.execute).toBe('function');
    expect(typeof def.output.render).toBe('function');
    expect(def.output.schema.type).toBe('object');
    expect(def.output.schema.additionalProperties).toBe(false);
  });

  it('buildAgentTools returns the three parsing tools in order', () => {
    const defs = buildAgentTools(makeState());
    expect(defs.map((d) => d.name)).toEqual([...TOOL_NAMES]);
    expect(defs.map((d) => d.name)).toEqual(['mineru_parse', 'mineru_batch_parse', 'mineru_task']);
    for (const d of defs) {
      expect(typeof d.execute).toBe('function');
      expect(typeof d.output.render).toBe('function');
    }
  });

  it('activate render returns an activation summary in text form', () => {
    const def = buildActivateTool(makeState());
    const blocks = def.output.render({}, {
      ok: true,
      active: true,
      already: false,
      mode: 'auto',
      api: 'agent',
      tokenConfigured: false,
      modelVersion: 'vlm',
      tools: ['mineru_parse', 'mineru_batch_parse', 'mineru_task'],
      skill: 'mineru-tools',
      limits: { precision: '200MB/200页', agent: '10MB/20页' },
    });
    expect(blocks[0].type).toBe('text');
    expect(blocks[0].text).toContain('MinerU 解析已激活.');
    expect(blocks[0].text).toContain('mineru_parse');
    expect(blocks[0].text).toContain('mineru-tools');
  });

  it('parse tool declares a required source parameter', () => {
    const [parseTool] = buildAgentTools(makeState());
    expect(parseTool.name).toBe('mineru_parse');
    expect(parseTool.parameters.source.type).toBe('string');
    expect(parseTool.parameters.source.required).toBe(true);
  });
});
