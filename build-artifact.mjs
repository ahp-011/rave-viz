// Builds a single self-contained HTML page for publishing as a Claude Artifact.
// three.js comes from jsDelivr through an import map; the app code is inlined.
import { build } from 'vite';
import fs from 'fs';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
await build({
  logLevel: 'warn',
  build: {
    outDir: 'dist-artifact', emptyOutDir: true, modulePreload: false,
    rollupOptions: { external: ['three'], output: { inlineDynamicImports: true } },
  },
});
const html = fs.readFileSync('dist-artifact/index.html', 'utf8');
const js = fs.readdirSync('dist-artifact/assets').filter(f => f.endsWith('.js'))
  .map(f => fs.readFileSync('dist-artifact/assets/' + f, 'utf8')).join('\n');
const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
const out = `<title>Rave Visualizer</title>
<meta name="claude:viewport-fit-sides" content="cover">
${style}
<script type="importmap">{"imports":{"three":"${THREE_URL}"}}</script>
<script type="module">
${js.replace(/<\/script/gi, '<\\/script')}
</script>
`;
fs.writeFileSync('rave-visualizer.html', out);
console.log('wrote rave-visualizer.html', (out.length / 1024).toFixed(0) + ' KB');
