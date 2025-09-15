#!/usr/bin/env bun

/**
 * Diagram Watcher
 *
 * Parses the repo's TypeScript files to build a module dependency graph
 * and regenerates Mermaid diagrams into docs/diagram.md. Supports a
 * watch mode to update on file changes.
 */

import fs from 'fs';
import path from 'path';
import ts from 'typescript';

type Graph = Map<string, Set<string>>; // file -> imported files

const REPO_ROOT = process.cwd();
const SRC_DIR = path.join(REPO_ROOT, 'src');
const DOC_PATH = path.join(REPO_ROOT, 'docs', 'diagram.md');

const exts = ['.ts', '.tsx', '.js', '.mjs'];

function isRelative(spec: string): boolean {
  return spec.startsWith('.') || spec.startsWith('..');
}

function normalizeLabel(file: string): string {
  return file.replace(REPO_ROOT + path.sep, '');
}

function fileExists(p: string): boolean {
  try { fs.accessSync(p, fs.constants.R_OK); return true; } catch { return false; }
}

function resolveImport(fromFile: string, specifier: string): string | null {
  const fromDir = path.dirname(fromFile);
  const tryPaths: string[] = [];

  // Handle .js -> .ts remap commonly used in ESM TypeScript projects
  const baseSpec = specifier.endsWith('.js') ? specifier.slice(0, -3) : specifier;
  const direct = path.resolve(fromDir, baseSpec);

  // 1) Exact file with extension
  if (path.extname(baseSpec)) {
    tryPaths.push(path.resolve(fromDir, baseSpec));
  } else {
    // 2) Try file with known extensions
    for (const ext of exts) tryPaths.push(direct + ext);
    // 3) Try index under a directory
    for (const ext of exts) tryPaths.push(path.join(direct, 'index' + ext));
    // 4) Try .ts if original had .js suffix
    if (specifier.endsWith('.js')) tryPaths.push(path.resolve(fromDir, baseSpec + '.ts'));
  }

  for (const candidate of tryPaths) {
    if (fileExists(candidate)) return path.normalize(candidate);
  }
  return null;
}

function parseImports(filePath: string): string[] {
  try {
    const sourceText = fs.readFileSync(filePath, 'utf8');
    const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
    const imports: string[] = [];
    sf.forEachChild(node => {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push(node.moduleSpecifier.text);
      }
    });
    return imports;
  } catch {
    return [];
  }
}

function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(abs);
      } else if (exts.includes(path.extname(e.name))) {
        out.push(abs);
      }
    }
  }
  return out;
}

function buildGraph(): Graph {
  const graph: Graph = new Map();
  const files = listSourceFiles(SRC_DIR);
  const fileSet = new Set(files.map(f => path.normalize(f)));

  for (const file of files) {
    const absFile = path.normalize(file);
    const relImports = parseImports(absFile).filter(isRelative);
    for (const spec of relImports) {
      const resolved = resolveImport(absFile, spec);
      if (!resolved) continue;
      // Only track edges to files we know (limit to src/*)
      if (!resolved.startsWith(SRC_DIR)) continue;
      if (!graph.has(absFile)) graph.set(absFile, new Set());
      graph.get(absFile)!.add(resolved);
    }
    if (!graph.has(absFile)) graph.set(absFile, new Set());
  }

  return graph;
}

function groupOf(file: string): string {
  const rel = normalizeLabel(file);
  if (rel.startsWith('src/trading/') || rel.startsWith('src/core/') || rel.startsWith('src/contracts/')) return 'Trading & Channels';
  if (rel.startsWith('src/network/') || rel.startsWith('src/monitoring/')) return 'P2P & Monitoring';
  if (rel.startsWith('src/evm.ts') || rel.startsWith('contracts/')) return 'EVM Integration';
  return 'Consensus Core';
}

function toMermaidModuleMap(graph: Graph): string {
  const nodes = Array.from(graph.keys());
  const edges: Array<[string, string]> = [];
  for (const [from, set] of graph.entries()) {
    for (const to of set) edges.push([from, to]);
  }

  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const g = groupOf(n);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(n);
  }

  let out = '```mermaid\n';
  out += 'graph LR\n';

  // Subgraphs by group
  for (const [gname, gnodes] of groups.entries()) {
    out += `  subgraph ${gname}\n`;
    for (const n of gnodes) {
      const label = normalizeLabel(n);
      out += `    ${nodeId(n)}[${label}]\n`;
    }
    out += '  end\n\n';
  }

  // Edges
  const seen = new Set<string>();
  for (const [from, to] of edges) {
    const key = nodeId(from) + '->' + nodeId(to);
    if (seen.has(key)) continue;
    seen.add(key);
    out += `  ${nodeId(from)} --> ${nodeId(to)}\n`;
  }

  out += '```\n';
  return out;
}

function filterGraph(graph: Graph, predicate: (file: string) => boolean): Graph {
  const g: Graph = new Map();
  for (const [from, tos] of graph.entries()) {
    if (!predicate(from)) continue;
    for (const to of tos) {
      if (!predicate(to)) continue;
      if (!g.has(from)) g.set(from, new Set());
      g.get(from)!.add(to);
    }
    if (!g.has(from)) g.set(from, new Set());
  }
  return g;
}

function nodeId(file: string): string {
  return normalizeLabel(file)
    .replace(/[^a-zA-Z0-9_]/g, '_');
}

function generateDoc(graph: Graph): string {
  const header = `# Architecture Diagrams\n\nThis file is auto-generated by utils/diagram-watcher.ts. Do not edit manually.\n`;

  const moduleMap = toMermaidModuleMap(graph);

  const trading = toMermaidModuleMap(
    filterGraph(graph, f => normalizeLabel(f).startsWith('src/trading/') || normalizeLabel(f).startsWith('src/core/') || normalizeLabel(f).startsWith('src/contracts/'))
  );

  const channels = toMermaidModuleMap(
    filterGraph(graph, f => normalizeLabel(f).includes('EnhancedChannel') || normalizeLabel(f).includes('SubcontractProvider') || normalizeLabel(f).startsWith('src/core/'))
  );

  const consensusFlow = `\n## Consensus Runtime Flow\n\n\n\`\`\`mermaid\nflowchart TD\n  A[Inputs: serverTxs + entityInputs] --> B[mergeEntityInputs]\n  B --> C[applyServerInput]\n  C --> D[Per-replica: applyEntityInput]\n  D --> E[applyEntityTx: chat/propose/vote/profile/j_event]\n  E --> F[State updates: frames, precommits, proposals]\n  F --> G[env.height++ / timestamp++]\n  G --> H[Capture snapshot → LevelDB]\n  H --> I[Outbox: new EntityInputs]\n  I -->|processUntilEmpty loop| C\n\n  J[JEventWatcher (ethers RPC)] --> E\n  K[Profiles/Name Index (Level)] --> E\n  UI[Frontend] <---> server[server.ts]\n\n\`\`\`\n`;

  return [
    header,
    '## Module Map\n\n', moduleMap,
    consensusFlow,
    '## Trading Overview (Unified)\n\n', trading,
    '## Channels Overview\n\n', channels
  ].join('');
}

function writeDoc(content: string) {
  fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
  fs.writeFileSync(DOC_PATH, content, 'utf8');
}

function generateOnce(): void {
  const graph = buildGraph();
  const doc = generateDoc(graph);
  writeDoc(doc);
  console.log(`✅ Updated ${path.relative(REPO_ROOT, DOC_PATH)}`);
}

function watchAndGenerate(): void {
  console.log('👀 Watching for changes in src/**/*.ts to update diagrams...');
  let timer: NodeJS.Timeout | null = null;
  const trigger = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try { generateOnce(); } catch (e) { console.error('❌ Diagram generation failed:', e); }
    }, 150);
  };

  // Initial build
  generateOnce();

  // Recursive watch (macOS/Linux support recursive for fs.watch)
  fs.watch(SRC_DIR, { recursive: true }, (_event, filename) => {
    if (!filename) { trigger(); return; }
    if (exts.includes(path.extname(filename))) trigger();
  });
}

// Entry
const args = process.argv.slice(2);
if (args.includes('--watch') || args.includes('-w')) {
  watchAndGenerate();
} else {
  generateOnce();
}

