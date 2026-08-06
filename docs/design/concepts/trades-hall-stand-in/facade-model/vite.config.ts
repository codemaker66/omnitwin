import { fileURLToPath, URL } from "node:url";

export default {
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      three: fileURLToPath(new URL("../../../../../packages/web/node_modules/three", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5194,
    strictPort: true,
  },
};
