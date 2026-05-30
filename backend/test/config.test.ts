import { describe, expect, it } from 'vitest';
import { ConfigValidationError, parseConfig } from '../src/config.js';

describe('parseConfig — standard mcpServers map', () => {
  it('derives the server name from the object key', () => {
    const cfg = parseConfig({
      mcpServers: {
        'zomato-mcp': { command: 'npx', args: ['mcp-remote', 'https://mcp-server.zomato.com/mcp'] },
      },
    });
    expect(cfg.servers).toHaveLength(1);
    expect(cfg.servers[0]).toMatchObject({
      name: 'zomato-mcp',
      command: 'npx',
      args: ['mcp-remote', 'https://mcp-server.zomato.com/mcp'],
    });
  });

  it('supports multiple servers in one map', () => {
    const cfg = parseConfig({
      mcpServers: {
        filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
        everything: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] },
      },
    });
    expect(cfg.servers.map((s) => s.name).sort()).toEqual(['everything', 'filesystem']);
  });

  it('defaults args to an empty array and preserves env/cwd', () => {
    const cfg = parseConfig({
      mcpServers: { github: { command: 'npx', env: { GITHUB_TOKEN: null }, cwd: '/srv' } },
    });
    expect(cfg.servers[0]).toMatchObject({
      name: 'github',
      command: 'npx',
      args: [],
      env: { GITHUB_TOKEN: null },
      cwd: '/srv',
    });
  });

  it('rejects an empty mcpServers map', () => {
    expect(() => parseConfig({ mcpServers: {} })).toThrow(ConfigValidationError);
  });

  it('rejects an invalid server-name key', () => {
    expect(() => parseConfig({ mcpServers: { '1bad': { command: 'npx' } } })).toThrow(
      ConfigValidationError,
    );
  });

  it('rejects an entry missing command', () => {
    expect(() => parseConfig({ mcpServers: { x: { args: [] } } })).toThrow(ConfigValidationError);
  });
});

describe('parseConfig — legacy servers array', () => {
  it('still parses the array form with explicit names', () => {
    const cfg = parseConfig({ servers: [{ name: 'fs', command: 'npx', args: [] }] });
    expect(cfg.servers[0]).toMatchObject({ name: 'fs', command: 'npx', args: [] });
  });

  it('rejects duplicate names', () => {
    expect(() =>
      parseConfig({
        servers: [
          { name: 'dup', command: 'npx' },
          { name: 'dup', command: 'node' },
        ],
      }),
    ).toThrow(ConfigValidationError);
  });
});

describe('parseConfig — bad shapes', () => {
  it('rejects non-objects', () => {
    expect(() => parseConfig(null)).toThrow(ConfigValidationError);
    expect(() => parseConfig([])).toThrow(ConfigValidationError);
    expect(() => parseConfig('nope')).toThrow(ConfigValidationError);
  });

  it('rejects an object with neither mcpServers nor servers', () => {
    expect(() => parseConfig({})).toThrow(ConfigValidationError);
  });
});
