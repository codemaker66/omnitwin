// Serves the measuring page, three, and the work directory's data/ for the
// headless renders: the page loads the dollhouse mesh and draws orthographic
// position buffers and per-station distance cubemaps from it.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { playwright, threeDirectory } from "./modules.mjs";

const PAGE = fileURLToPath(new URL("./page/", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".glb": "model/gltf-binary", ".wasm": "application/wasm" };

function inside(root, path) {
  const full = resolve(root, "." + normalize("/" + path));
  return full.startsWith(resolve(root)) ? full : null;
}

export async function startPageServer(workDir) {
  const roots = { "/three/": threeDirectory(), "/data/": join(resolve(workDir), "data") };
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://local").pathname);
    let file = null;
    if (path === "/" || path === "/index.html") file = join(PAGE, "index.html");
    for (const [prefix, root] of Object.entries(roots)) if (path.startsWith(prefix)) file = inside(root, path.slice(prefix.length));
    if (file === null) { response.writeHead(404).end(); return; }
    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${String(port)}/index.html`, close: () => new Promise((done) => server.close(done)) };
}

/** Opens the measuring page in headless Chromium (software GL) and waits for the mesh. */
export async function openMeasuringPage(workDir) {
  const { chromium } = await playwright();
  const server = await startPageServer(workDir);
  const executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on("pageerror", (error) => console.log("pageerror", error.message));
  await page.goto(server.url);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 300000 });
  return { page, close: async () => { await browser.close(); await server.close(); } };
}
