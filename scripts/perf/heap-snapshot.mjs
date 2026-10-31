/**
 * Summarise a Chromium .heapsnapshot and a CDP memory-infra dump.
 *
 * The snapshot is the V8 JSON format: one flat `nodes` array, stride
 * `node_fields.length`. String contents are not grouped by value — a string's
 * name is the text itself, and grouping those hides the type total.
 *
 *   node --input-type=module -e "import { selfTest } from './scripts/perf/heap-snapshot.mjs'; selfTest()"
 */
const STRING_TYPES = new Set(['string', 'concatenated string', 'sliced string']);

function bucketAdd(map, key, size) {
  const row = map.get(key);
  if (row) {
    row.count += 1;
    row.bytes += size;
  } else {
    map.set(key, { count: 1, bytes: size });
  }
}

function asObject(map) {
  return Object.fromEntries(map);
}

/**
 * @param {object} json Parsed heapsnapshot.
 * @returns {{ nodeCount: number, selfBytes: number, byType: object, byName: object, detached: object }}
 */
export function summarizeHeapSnapshot(json) {
  const meta = json?.snapshot?.meta;
  const fields = meta?.node_fields;
  if (!Array.isArray(fields)) throw new Error('heap snapshot is missing snapshot.meta.node_fields');
  const stride = fields.length;
  const typeAt = fields.indexOf('type');
  const nameAt = fields.indexOf('name');
  const sizeAt = fields.indexOf('self_size');
  const detAt = fields.indexOf('detachedness');
  if (typeAt < 0 || nameAt < 0 || sizeAt < 0) throw new Error(`heap snapshot fields are ${fields.join(',')}`);
  const typeNames = meta.node_types?.[typeAt] ?? meta.node_types?.[0];
  if (!Array.isArray(typeNames)) throw new Error('heap snapshot is missing node type names');
  const strings = json.strings ?? [];
  const nodes = json.nodes;
  const count = json.snapshot.node_count;
  if (!Array.isArray(nodes) || nodes.length < count * stride) {
    throw new Error(`heap snapshot nodes truncated: ${nodes?.length ?? 0} < ${count} * ${stride}`);
  }
  const byType = new Map();
  const byName = new Map();
  const detachedByName = new Map();
  let detachedCount = 0;
  let detachedBytes = 0;
  let selfBytes = 0;
  for (let i = 0; i < count; i++) {
    const base = i * stride;
    const type = typeNames[nodes[base + typeAt]] ?? 'unknown';
    const nameId = nodes[base + nameAt];
    const name = typeof nameId === 'number' ? (strings[nameId] ?? '') : String(nameId ?? '');
    const size = Number(nodes[base + sizeAt]) || 0;
    const detached = detAt >= 0 && Number(nodes[base + detAt]) > 0;
    selfBytes += size;
    bucketAdd(byType, type, size);
    if (!STRING_TYPES.has(type)) bucketAdd(byName, `${type}:${name || '(anonymous)'}`, size);
    if (detached) {
      detachedCount += 1;
      detachedBytes += size;
      bucketAdd(detachedByName, `${type}:${name || '(anonymous)'}`, size);
    }
  }
  return {
    nodeCount: count,
    selfBytes,
    byType: asObject(byType),
    byName: asObject(byName),
    detached: { count: detachedCount, bytes: detachedBytes, byName: asObject(detachedByName) },
  };
}

export function diffBuckets(before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const rows = [];
  for (const key of keys) {
    const a = before?.[key] ?? { count: 0, bytes: 0 };
    const b = after?.[key] ?? { count: 0, bytes: 0 };
    rows.push({
      name: key,
      count: b.count - a.count,
      bytes: b.bytes - a.bytes,
      countBefore: a.count,
      countAfter: b.count,
      bytesBefore: a.bytes,
      bytesAfter: b.bytes,
    });
  }
  rows.sort((x, y) => Math.abs(y.bytes) - Math.abs(x.bytes) || Math.abs(y.count) - Math.abs(x.count));
  return rows;
}

function sumTypes(byType, names) {
  let bytes = 0;
  let count = 0;
  for (const name of names) {
    const row = byType?.[name];
    if (!row) continue;
    bytes += row.bytes;
    count += row.count;
  }
  return { bytes, count };
}

/** Totals the report always prints, whether or not they lead the diff. */
export function heapGroups(summary) {
  const byType = summary?.byType ?? {};
  return {
    strings: sumTypes(byType, ['string', 'concatenated string', 'sliced string']),
    arrays: sumTypes(byType, ['array']),
    closures: sumTypes(byType, ['closure']),
    objects: sumTypes(byType, ['object']),
    native: sumTypes(byType, ['native']),
    code: sumTypes(byType, ['code']),
    numbers: sumTypes(byType, ['number']),
    detached: {
      count: summary?.detached?.count ?? 0,
      bytes: summary?.detached?.bytes ?? 0,
    },
    selfBytes: summary?.selfBytes ?? 0,
    nodeCount: summary?.nodeCount ?? 0,
  };
}

export function diffGroups(before, after) {
  const a = heapGroups(before);
  const b = heapGroups(after);
  const out = {};
  for (const key of Object.keys(b)) {
    if (key === 'detached') {
      out.detached = {
        count: b.detached.count - a.detached.count,
        bytes: b.detached.bytes - a.detached.bytes,
        before: a.detached,
        after: b.detached,
      };
    } else if (typeof b[key] === 'number') {
      out[key] = { bytes: b[key] - a[key], before: a[key], after: b[key] };
    } else {
      out[key] = {
        count: b[key].count - a[key].count,
        bytes: b[key].bytes - a[key].bytes,
        before: a[key],
        after: b[key],
      };
    }
  }
  return out;
}

const WATCH = ['ArrayBuffer', 'JSArrayBufferData', 'AudioBuffer', 'Uint8Array', 'Float32Array', 'Int16Array', 'HTMLAudioElement', 'HTMLCanvasElement', 'Detached', 'Array'];

export function watchedDiff(rows) {
  const hit = [];
  for (const token of WATCH) {
    const matched = rows.filter((row) => row.name.includes(token));
    if (matched.length === 0) continue;
    hit.push({
      token,
      count: matched.reduce((s, row) => s + row.count, 0),
      bytes: matched.reduce((s, row) => s + row.bytes, 0),
      names: matched.slice(0, 8).map((row) => row.name),
    });
  }
  return hit;
}

function byteValue(node) {
  if (!node || typeof node !== 'object' || node.value == null) return null;
  if (node.units != null && node.units !== 'bytes') return null;
  const n = Number(node.value);
  return Number.isFinite(n) ? n : null;
}

function readDumpSize(value) {
  if (!value || typeof value !== 'object') return null;
  const fromAttrs = byteValue(value.attrs?.size);
  if (fromAttrs != null) return fromAttrs;
  if (typeof value.size === 'number' && Number.isFinite(value.size)) return value.size;
  const fromSize = byteValue(value.size);
  if (fromSize != null) return fromSize;
  return byteValue(value);
}

/**
 * Walk one memory-infra dump. A node with its own byte size is that total
 * (children are recorded too, but not added on top of the parent).
 */
function collectDumpSizes(node, path, out) {
  if (!node || typeof node !== 'object') return 0;
  const own = readDumpSize(node);
  let childBytes = 0;
  let children = 0;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'size' || key === 'units' || key === 'value' || key === 'guid' || key === 'attrs') continue;
    if (!value || typeof value !== 'object') continue;
    const childPath = path ? `${path}/${key}` : key;
    childBytes += collectDumpSizes(value, childPath, out);
    children += 1;
  }
  if (own != null) {
    out[path || 'total'] = (out[path || 'total'] ?? 0) + own;
    return own;
  }
  if (children > 0 && path) out[path] = (out[path] ?? 0) + childBytes;
  return childBytes;
}

/**
 * Sum allocator bytes from Tracing memory-infra events (`ph: "v"`).
 * `pidRoles` maps an OS pid to browser / renderer / gpu / … when known.
 */
export function summarizeMemoryDump(events, pidRoles = new Map()) {
  const paths = {};
  const byRole = {};
  let dumps = 0;
  for (const ev of events ?? []) {
    const dump = ev?.args?.dumps;
    if (ev?.ph !== 'v' || !dump || typeof dump !== 'object') continue;
    dumps += 1;
    const local = {};
    for (const [key, value] of Object.entries(dump)) {
      if (key === 'level_of_detail') continue;
      collectDumpSizes(value, key, local);
    }
    const role = pidRoles.get(ev.pid) ?? 'unknown';
    const roleBucket = byRole[role] ?? (byRole[role] = {});
    for (const [key, bytes] of Object.entries(local)) {
      paths[key] = (paths[key] ?? 0) + bytes;
      roleBucket[key] = (roleBucket[key] ?? 0) + bytes;
    }
  }
  return { dumps, paths, byRole, events: (events ?? []).length };
}

export function diffNumbers(before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const rows = [];
  for (const key of keys) {
    const a = Number(before?.[key] ?? 0);
    const b = Number(after?.[key] ?? 0);
    rows.push({ name: key, before: a, after: b, bytes: b - a });
  }
  rows.sort((x, y) => Math.abs(y.bytes) - Math.abs(x.bytes));
  return rows;
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/** Tiny snapshot pair so the diff math can be checked without a browser. */
export function selfTest() {
  const types = ['hidden', 'array', 'string', 'object', 'code', 'closure', 'regexp', 'number', 'native', 'synthetic', 'concatenated string', 'sliced string', 'symbol', 'bigint'];
  const strings = ['', 'Array', 'tick', 'HTMLDivElement', 'system / JSArrayBufferData', 'kept'];
  const field = (type, name, size, detached) => [types.indexOf(type), strings.indexOf(name), 1, size, 0, 0, detached];
  const snap = (specs) => {
    const nodes = specs.flat();
    return {
      snapshot: {
        meta: {
          node_fields: ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id', 'detachedness'],
          node_types: [types],
        },
        node_count: specs.length,
        edge_count: 0,
      },
      nodes,
      edges: [],
      strings,
    };
  };
  const before = summarizeHeapSnapshot(
    snap([
      field('object', 'Array', 100, 0),
      field('string', 'kept', 40, 0),
      field('closure', 'tick', 20, 0),
      field('object', 'HTMLDivElement', 30, 1),
      field('array', '', 16, 0),
    ]),
  );
  const after = summarizeHeapSnapshot(
    snap([
      field('object', 'Array', 100, 0),
      field('object', 'Array', 80, 0),
      field('string', 'kept', 40, 0),
      field('string', 'kept', 200, 0),
      field('closure', 'tick', 20, 0),
      field('closure', 'tick', 50, 0),
      field('object', 'HTMLDivElement', 30, 1),
      field('object', 'HTMLDivElement', 30, 1),
      field('array', '', 16, 0),
      field('array', '', 64, 0),
      field('native', 'system / JSArrayBufferData', 5000, 0),
    ]),
  );
  const groups = diffGroups(before, after);
  assert(groups.strings.bytes === 200, `strings ${groups.strings.bytes}`);
  assert(groups.strings.count === 1, `string count ${groups.strings.count}`);
  assert(groups.closures.count === 1 && groups.closures.bytes === 50, `closures ${groups.closures.count}/${groups.closures.bytes}`);
  assert(groups.arrays.count === 1 && groups.arrays.bytes === 64, `arrays ${groups.arrays.count}/${groups.arrays.bytes}`);
  assert(groups.detached.count === 1 && groups.detached.bytes === 30, `detached ${groups.detached.count}/${groups.detached.bytes}`);
  assert(groups.native.bytes === 5000, `native ${groups.native.bytes}`);
  const rows = diffBuckets(before.byName, after.byName);
  const array = rows.find((row) => row.name === 'object:Array');
  assert(array && array.count === 1 && array.bytes === 80, 'Array object delta');
  const watch = watchedDiff(rows);
  assert(watch.some((row) => row.token === 'JSArrayBufferData' && row.bytes === 5000), 'watched buffer');
  const dump = summarizeMemoryDump(
    [
      {
        ph: 'v',
        pid: 7,
        args: {
          dumps: {
            allocators: {
              malloc: { attrs: { size: { units: 'bytes', value: '1000' } } },
              v8: { allocated: { attrs: { size: { units: 'bytes', value: '400' } } } },
            },
          },
        },
      },
      {
        ph: 'v',
        pid: 8,
        args: { dumps: { gpu: { gl: { size: { units: 'bytes', value: '50' } } } } },
      },
    ],
    new Map([
      [7, 'renderer'],
      [8, 'gpu'],
    ]),
  );
  assert(dump.dumps === 2, `dumps ${dump.dumps}`);
  assert(dump.byRole.renderer['allocators/malloc'] === 1000, 'renderer malloc');
  assert(dump.byRole.renderer['allocators/v8/allocated'] === 400, 'nested v8');
  assert(dump.byRole.gpu['gpu/gl'] === 50, 'gpu gl');
  const grown = diffNumbers({ malloc: 1000 }, { malloc: 1800, gpu: 50 });
  assert(grown[0].name === 'malloc' && grown[0].bytes === 800, 'numeric diff');
  return 'ok';
}
