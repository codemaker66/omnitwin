// Add the hosting adapter at the imported game's stable bootstrap boundary.
// The upstream export and all its media remain untouched. Audio versioning must
// run afterwards with this prepared output as its source, covering this module.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bootstrap = "else await Qf(e,n,r,s);await i,await f.run()";
const replay = "function nu(){try{localStorage.setItem(`amissing-replay`,`1`)}";
const eagerArtwork = "d.preload();let f=new uf";

export function adaptEntry(entry, revision, audioIds = []) {
  for (const marker of [bootstrap, replay, eagerArtwork]) {
    if (entry.split(marker).length !== 2) {
      throw new Error("The Amissing Book bootstrap changed; review save/resume integration");
    }
  }
  return 'import { installResume, clearCheckpoint } from "./amissing-book-resume.js";\n' + entry
    // The export queues 52 future images before Begin. On a cold connection
    // those requests can starve every title cue and prevent the opening from
    // starting. Scene/actor loaders still await the exact artwork on demand;
    // retain later chapter warming, portraits and all authored audio timings.
    .replace(eagerArtwork, "let f=new uf")
    .replace(bootstrap, `else{await i;await installResume({host:e,stage:n,audio:r,runner:f,soul:c,director:d,scenes:Df,crafts:Mc,revision:${JSON.stringify(revision)},audioIds:${JSON.stringify(audioIds)}}).start(()=>Qf(e,n,r,s))}await i,await f.run()`)
    .replace(replay, "function nu(){clearCheckpoint();try{localStorage.setItem(`amissing-replay`,`1`)}");
}

export function adaptHtml(html) {
  if (html.split("</head>").length !== 2) throw new Error("The Amissing Book document head changed");
  if (/rel=["'](?:shortcut )?icon["']/u.test(html)) return html;
  return html.replace("</head>", '    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />\n  </head>');
}

export function prepare(output, source) {
  const html = readFileSync(join(source, "index.html"), "utf8");
  const entryName = /<script[^>]+src="\/amissing-book\/assets\/([^"/]+\.js)"/u.exec(html)?.[1];
  if (!entryName) throw new Error("The Amissing Book entry module changed");
  const entry = readFileSync(join(source, "assets", entryName), "utf8");
  // A changed story invalidates checkpoints; a new narration take does not.
  const revision = createHash("sha256").update(entry).digest("hex");
  const audioIds = Object.keys(JSON.parse(readFileSync(join(source, "audio/index.json"), "utf8")));
  const transformed = adaptEntry(entry, revision, audioIds);
  mkdirSync(join(output, "assets"), { recursive: true });
  writeFileSync(join(output, "assets", entryName), transformed);
  writeFileSync(join(output, "assets", "amissing-book-resume.js"),
    readFileSync(new URL("./amissing-book/resume-runtime.mjs", import.meta.url)));
  writeFileSync(join(output, "index.html"), adaptHtml(html));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepare(resolve(process.argv[2] ?? join(import.meta.dirname, "../dist/amissing-book")),
    resolve(process.argv[3] ?? join(import.meta.dirname, "../public/amissing-book")));
  console.log("The Amissing Book: added choice checkpoints without changing the upstream export");
}
