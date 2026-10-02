import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import pkg from '../package.json';
import workitem from '../src/cli/commands/workitem';
import sprint from '../src/cli/commands/sprint';
import board from '../src/cli/commands/board';
import project from '../src/cli/commands/project';
import metadata from '../src/cli/commands/metadata';
import flow from '../src/cli/commands/flow';
import stats from '../src/cli/commands/stats';
import config from '../src/cli/commands/config';
import { validateFlows } from '../src/services/flowRules';

const ROOT = path.resolve(import.meta.dir, '..');
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf-8'));

const marketplace = readJson('.claude-plugin/marketplace.json');
const entry = marketplace.plugins[0];
const PLUGIN_DIR = path.join(ROOT, entry.source);
const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, '.claude-plugin/plugin.json'), 'utf-8'));

const SKILLS_DIR = path.join(PLUGIN_DIR, 'skills');
const skills = fs.readdirSync(SKILLS_DIR).map(dir => {
  const file = path.join(SKILLS_DIR, dir, 'SKILL.md');
  return { dir, file, text: fs.readFileSync(file, 'utf-8') };
});

const GROUPS: Record<string, { subCommands?: unknown }> = { workitem, sprint, board, project, metadata, flow, stats, config };
const subCommands = (group: string) => Object.keys((GROUPS[group]!.subCommands ?? {}) as object);

function frontmatter(text: string): Record<string, unknown> {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error('no frontmatter block');
  return Bun.YAML.parse(match[1]!) as Record<string, unknown>;
}

describe('plugin manifest', () => {
  it('ships the same version as the CLI, in plugin.json and in the marketplace', () => {
    expect(manifest.version).toBe(pkg.version);
    expect(entry.version).toBe(pkg.version);
  });

  it('is the plugin the marketplace points at', () => {
    expect(entry.name).toBe(manifest.name);
    expect(entry.source.startsWith('./')).toBe(true);
  });

  it('keeps the CLI source out of the installed plugin directory', () => {
    expect(fs.readdirSync(PLUGIN_DIR).sort()).toEqual(['.claude-plugin', 'skills']);
  });
});

describe('plugin skills', () => {
  it('has at least the cli, conventions and setup skills', () => {
    expect(skills.map(s => s.dir).sort()).toEqual(['azdev-cli', 'conventions', 'setup']);
  });

  for (const skill of skills) {
    describe(skill.dir, () => {
      // `claude plugin validate` does not parse skill frontmatter; an unquoted ": " would
      // silently load the skill with no name or description.
      it('has strict YAML frontmatter with a name matching its directory and a description', () => {
        const meta = frontmatter(skill.text);
        expect(meta.name).toBe(skill.dir);
        expect(typeof meta.description).toBe('string');
        expect((meta.description as string).length).toBeGreaterThan(40);
      });

      it('references only bundled files that exist', () => {
        const refs = [...skill.text.matchAll(/`((?:assets|references|scripts)\/[^`]+)`/g)].map(m => m[1]!);
        for (const ref of refs) expect(fs.existsSync(path.join(SKILLS_DIR, skill.dir, ref))).toBe(true);
      });

      it('only mentions azdev subcommands that exist', () => {
        const mentioned = [...skill.text.matchAll(/\bazdev (\w+) ([a-z][\w-]*)/g)]
          .filter(m => m[1]! in GROUPS)
          .map(m => `${m[1]} ${m[2]}`);
        const missing = mentioned.filter(cmd => {
          const [group, sub] = cmd.split(' ');
          return !subCommands(group!).includes(sub!);
        });
        expect(missing).toEqual([]);
      });
    });
  }

  it('states the real number of subcommands in the cli skill', () => {
    const total = Object.keys(GROUPS).reduce((sum, group) => sum + subCommands(group).length, 0);
    const cli = skills.find(s => s.dir === 'azdev-cli')!.text;
    expect(cli).toContain(`${total} subcommands across ${Object.keys(GROUPS).length} groups`);
  });

  // The reference is what the agent reads instead of guessing flags; a flag added to the
  // CLI without a line here is a flag the agent will not know about.
  it('documents every subcommand and every flag in references/commands.md', () => {
    const reference = fs.readFileSync(path.join(SKILLS_DIR, 'azdev-cli/references/commands.md'), 'utf-8');
    const sections = new Map(
      reference.split(/^### /m).slice(1).map(chunk => [chunk.slice(0, chunk.indexOf('\n')).trim(), chunk]),
    );
    const GLOBAL_FLAGS = new Set(['json', 'markdown', 'project']);
    const gaps: string[] = [];
    for (const [group, command] of Object.entries(GROUPS)) {
      for (const [sub, definition] of Object.entries(command.subCommands as Record<string, { args?: Record<string, { type?: string }> }>)) {
        const section = sections.get(`${group} ${sub}`);
        if (!section) {
          gaps.push(`${group} ${sub}: no section`);
          continue;
        }
        for (const [flag, arg] of Object.entries(definition.args ?? {})) {
          if (arg.type === 'positional' || GLOBAL_FLAGS.has(flag)) continue;
          if (!section.includes(`--${flag}`)) gaps.push(`${group} ${sub}: --${flag}`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it('ships an example flows.json that azdev accepts', () => {
    const example = JSON.parse(fs.readFileSync(path.join(SKILLS_DIR, 'conventions/assets/flows.example.json'), 'utf-8'));
    expect(() => validateFlows(example)).not.toThrow();
  });
});
