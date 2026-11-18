import { writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/** Dev-only endpoint for /lab: POST /__lab/save writes src/config/materials.json. */
function labSave(): Plugin {
  return {
    name: 'lab-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__lab/save', (req, res) => {
        if (req.method !== 'POST') return void res.writeHead(405).end();
        let body = '';
        req.on('data', (c: Buffer) => (body += c.toString()));
        req.on('end', () => {
          try {
            const j = JSON.parse(body) as Record<string, unknown>;
            if (!j.materials || !j.hdris || !j.models) throw new Error('bad shape');
            writeFileSync('src/config/materials.json', JSON.stringify(j, null, 2) + '\n');
            res.writeHead(200).end('ok');
          } catch (e) {
            res.writeHead(400).end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  // '/' on Vercel and locally; '/modulo-classroom/' on GitHub Pages (set by the deploy workflow).
  base: process.env.BASE_PATH ?? '/',
  plugins: [labSave()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: 'index.html',
        lab: 'lab.html',
      },
    },
  },
});
