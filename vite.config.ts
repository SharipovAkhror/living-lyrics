import { gzipSync } from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/** Structural ceilings checked on every production build. Not a browser profile. */
function speedBudget(): Plugin {
  const ENTRY_GZIP = 200_000;
  const LYRICS_GZIP = 20_000;
  // The sheet was already 20500 before round 13. 20600 leaves a little room.
  const CSS_GZIP = 20_600;
  return {
    name: 'speed-budget',
    generateBundle(this: { error(message: string): never; info(message: string): void }, _opts, bundle) {
      type Chunk = {
        type: 'chunk';
        fileName: string;
        code: string;
        isEntry: boolean;
        imports: string[];
        facadeModuleId: string | null;
        modules: Record<string, unknown>;
      };
      type Asset = { type: 'asset'; fileName: string; source: string | Uint8Array };
      const files = bundle as Record<string, Chunk | Asset>;
      const chunks = Object.values(files).filter((f): f is Chunk => f.type === 'chunk');
      const entry = chunks.find((c) => c.isEntry && /(^|\/)index-/.test(c.fileName)) ?? chunks.find((c) => c.isEntry);
      if (!entry) this.error('speed budget: no entry chunk');
      const gzip = (code: string | Uint8Array) => gzipSync(typeof code === 'string' ? Buffer.from(code) : code).length;
      const sync = new Set<string>();
      const walk = (fileName: string) => {
        if (sync.has(fileName)) return;
        sync.add(fileName);
        const file = files[fileName];
        if (!file || file.type !== 'chunk') return;
        for (const child of file.imports) walk(child);
      };
      walk(entry!.fileName);

      const problems: string[] = [];
      const entryGzip = gzip(entry!.code);
      if (entryGzip > ENTRY_GZIP) problems.push(`entry gzip ${entryGzip} > ${ENTRY_GZIP}`);

      for (const file of Object.values(files)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.css') || !file.fileName.includes('index')) continue;
        const n = gzip(file.source);
        if (n > CSS_GZIP) problems.push(`css ${file.fileName} gzip ${n} > ${CSS_GZIP}`);
      }

      const isLyrics = (chunk: Chunk) => {
        const facade = chunk.facadeModuleId ?? '';
        return facade.includes('lyrics.json') || Object.keys(chunk.modules).some((id) => id.includes('lyrics.json'));
      };
      const mentionsThree = (chunk: Chunk) =>
        /(?:^|\/)three(?:\.|\/|-)/.test(chunk.fileName) ||
        Object.keys(chunk.modules).some((id) => /[/\\]three[/\\]/.test(id) || id.includes('three.module'));
      const mentionsFeatures = (chunk: Chunk) => Object.keys(chunk.modules).some((id) => id.includes('features.json'));

      for (const chunk of chunks) {
        if (!isLyrics(chunk)) continue;
        const n = gzip(chunk.code);
        if (n > LYRICS_GZIP) problems.push(`lyrics ${chunk.fileName} gzip ${n} > ${LYRICS_GZIP}`);
        if (sync.has(chunk.fileName)) problems.push(`lyrics ${chunk.fileName} is a sync import of the entry`);
      }
      for (const fileName of sync) {
        const file = files[fileName];
        if (!file || file.type !== 'chunk') continue;
        if (mentionsThree(file)) problems.push(`three is in the sync graph (${file.fileName})`);
        if (mentionsFeatures(file)) problems.push(`features.json is bundled in ${file.fileName}`);
      }

      if (problems.length) this.error(`speed budget failed:\n${problems.join('\n')}`);
      this.info(`speed budget ok: entry gzip ${entryGzip}`);
    },
  };
}

/**
 * WebKit does not composite the inline theme background while a stylesheet in
 * the head is still pending, so a screenshot at navigation commit is black.
 * The sheets still load; they just do not hold that first paint.
 */
function firstPaint(): Plugin {
  return {
    name: 'first-paint',
    transformIndexHtml(html) {
      return html.replace(/<link rel="stylesheet" ([^>]*?)href="([^"]+)"([^>]*)>/g, (_match, before: string, href: string, after: string) => {
        const attrs = `${before}${after}`.replace(/\s*\/\s*$/, '').trim();
        const extra = attrs ? ` ${attrs}` : '';
        return `<link rel="preload" href="${href}" as="style"${extra}><link rel="stylesheet" href="${href}"${extra} media="print" onload="this.media='all'">`;
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), speedBudget(), firstPaint()],
  // `?fill=1` shows unproven word fill for checks; `?ll-mutate=` plants a motion
  // fault for the gate proof; `?ll-render-error=1` throws once inside the scene.
  // The production site must never honour any of them.
  define: {
    __FILL_QUERY__: JSON.stringify(process.env.VERCEL_ENV !== 'production'),
    __MUTATE_QUERY__: JSON.stringify(process.env.VERCEL_ENV !== 'production'),
    __SCENE_PROBE__: JSON.stringify(process.env.VERCEL_ENV !== 'production'),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@content': fileURLToPath(new URL('./content', import.meta.url)),
    },
  },
  server: { host: true, port: 5173 },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
