/**
 * 散列节点图视图自检：验证分析 API 数据可支撑图构建
 * 运行：node scripts/verify-graph-view.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const samplePath = join(root, 'samples');

/** @param {string} references */
function mergeGraphReferences(references) {
  const seen = new Map();
  for (const ref of references) {
    const key = `${ref.fromId}|${ref.toId}|${ref.kind}`;
    if (!seen.has(key)) {
      seen.set(key, ref);
    }
  }
  return [...seen.values()];
}

async function main() {
  const resp = await fetch('http://127.0.0.1:8780/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath: samplePath })
  });
  if (!resp.ok) {
    throw new Error(`analyze failed: ${resp.status}`);
  }
  const data = await resp.json();
  const merged = mergeGraphReferences(data.references);
  const cyPath = join(root, 'wwwroot', 'vendor', 'cytoscape.min.js');
  const cySize = readFileSync(cyPath).length;

  console.log('[verify-graph-view] classes:', data.classes.length);
  console.log('[verify-graph-view] references:', data.references.length, 'merged edges:', merged.length);
  console.log('[verify-graph-view] layers:', data.layers.length);
  console.log('[verify-graph-view] cytoscape vendor bytes:', cySize);

  const kinds = new Set(merged.map((e) => e.kind));
  console.log('[verify-graph-view] edge kinds:', [...kinds].join(', '));

  if (data.classes.length < 1) {
    throw new Error('expected at least 1 class');
  }
  if (merged.length < 1) {
    throw new Error('expected at least 1 merged edge');
  }
  if (cySize < 100000) {
    throw new Error('cytoscape vendor file too small');
  }

  console.log('[verify-graph-view] OK');
}

main().catch((err) => {
  console.error('[verify-graph-view] FAIL:', err.message);
  process.exit(1);
});
