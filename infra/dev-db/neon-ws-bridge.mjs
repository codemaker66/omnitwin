// ---------------------------------------------------------------------------
// Neon serverless-driver bridge for the LOCAL dev database (Slice 4, T-518).
//
// The @neondatabase/serverless driver speaks Postgres wire protocol over a
// WebSocket — it cannot open plain TCP. In db/client.ts the local branch
// disables TLS and pipelining, at which point the "proxy" is a pure byte
// shovel: every ws frame is raw Postgres bytes for the server, and every TCP
// chunk goes back as one binary frame. This is exactly what Neon's own
// wsproxy does; this file is the no-Docker stand-in for the neon-proxy
// service in docker-compose.yml (use that instead when Docker is available).
//
//   node infra/dev-db/neon-ws-bridge.mjs
//
// Listens on ws://localhost:54331 (LOCAL_WS_PROXY_PORT in db/client.ts) and
// forwards to Postgres on 127.0.0.1:54329. Dev tool only — never deployed.
// ---------------------------------------------------------------------------

import net from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// `ws` is not hoisted by pnpm, but it is a declared dependency of
// @fastify/websocket — resolve it through that package instead of adding a
// duplicate dependency for a dev script.
const apiDir = fileURLToPath(new URL("../../packages/api/", import.meta.url));
const requireFromApi = createRequire(apiDir);
const fastifyWebsocketEntry = requireFromApi.resolve("@fastify/websocket");
const { WebSocketServer } = createRequire(fastifyWebsocketEntry)("ws");

const WS_PORT = 54331; // must match LOCAL_WS_PROXY_PORT in packages/api/src/db/client.ts
const PG_HOST = "127.0.0.1";
const PG_PORT = 54329; // must match infra/dev-db/docker-compose.yml

const server = new WebSocketServer({ port: WS_PORT });
let nextId = 1;

server.on("connection", (socket) => {
  const id = nextId;
  nextId += 1;
  const pg = net.connect(PG_PORT, PG_HOST);
  let closed = false;

  const teardown = (reason) => {
    if (closed) return;
    closed = true;
    console.log(`[bridge] #${String(id)} closed (${reason})`);
    try {
      socket.close();
    } catch {
      /* already gone */
    }
    pg.destroy();
  };

  console.log(`[bridge] #${String(id)} open -> ${PG_HOST}:${String(PG_PORT)}`);

  socket.on("message", (data) => {
    pg.write(data);
  });
  pg.on("data", (data) => {
    if (socket.readyState === 1) socket.send(data);
  });

  socket.on("close", () => {
    teardown("ws close");
  });
  socket.on("error", (error) => {
    teardown(`ws error: ${String(error instanceof Error ? error.message : error)}`);
  });
  pg.on("close", () => {
    teardown("pg close");
  });
  pg.on("error", (error) => {
    teardown(`pg error: ${String(error instanceof Error ? error.message : error)}`);
  });
});

console.log(
  `[bridge] Neon-driver dev bridge listening on ws://localhost:${String(WS_PORT)} -> ${PG_HOST}:${String(PG_PORT)}`,
);
