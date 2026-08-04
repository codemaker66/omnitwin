import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function e57Fixture(): Buffer {
  const header = Buffer.alloc(48);
  header.write("ASTM-E57", 0, "ascii");
  header.writeUInt32LE(1, 8);
  header.writeUInt32LE(0, 12);
  header.writeBigUInt64LE(48n, 16);
  header.writeBigUInt64LE(0n, 24);
  header.writeBigUInt64LE(0n, 32);
  header.writeBigUInt64LE(1024n, 40);
  return header;
}

export async function writeMinimalCapture(root: string): Promise<void> {
  await mkdir(join(root, "th obj"), { recursive: true });
  await mkdir(join(root, "panoramas"), { recursive: true });
  await writeFile(join(root, "cloud_0.e57"), e57Fixture());
  await writeFile(
    join(root, "th obj", "424ff41f6e5d41969c635fcd61be9b3f.obj"),
    "mtllib 424ff41f6e5d41969c635fcd61be9b3f.mtl\n",
  );
  await writeFile(
    join(root, "th obj", "424ff41f6e5d41969c635fcd61be9b3f.mtl"),
    "newmtl material_0\n",
  );
  await writeFile(
    join(root, "th obj", "424ff41f6e5d41969c635fcd61be9b3f_000.jpg"),
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  );
  await writeFile(join(root, "th obj", "TH_OBJ_RC_ALIGNED.obj"), "mtllib edited.mtl\n");
  await writeFile(join(root, "panoramas", "scan_000.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await writeFile(join(root, "poses.json"), "{}\n");
}
