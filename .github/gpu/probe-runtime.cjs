const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require('/workspace/packages/web/node_modules/@playwright/test');
const playwright = require('/workspace/packages/web/node_modules/@playwright/test/package.json');

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=gl',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const graphics = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
      const gl = canvas.getContext('webgl2');
      if (!gl) throw new Error('WebGL2 unavailable');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      if (!debug) throw new Error('Renderer identity unavailable');
      gl.clearColor(0, 1, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      const pixel = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (JSON.stringify(Array.from(pixel)) !== '[0,255,0,255]' || gl.isContextLost()) throw new Error('GPU readback failed');
      return { renderer: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) };
    });
    const os = readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="([^"]+)"$/m)?.[1];
    if (!os) throw new Error('OS identity unavailable');
    const drivers = execFileSync('/usr/lib/wsl/lib/nvidia-smi',
      ['--query-gpu=driver_version', '--format=csv,noheader'], { encoding: 'utf8', timeout: 10000 }).trim().split('\n');
    if (drivers.length !== 1 || !/^\d+\.\d+$/.test(drivers[0])) throw new Error('Single GPU driver required');
    process.stdout.write(JSON.stringify({ schemaVersion: 1, renderer: graphics.renderer,
      runtime: { node: process.versions.node, playwright: playwright.version, chromium: browser.version(),
        os: `${os}; ${execFileSync('uname', ['-sr'], { encoding: 'utf8' }).trim()}`,
        driver: `NVIDIA ${drivers[0]}; WSL D3D12` } }) + '\n');
  } finally { await browser.close(); }
})().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
