import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gitEnv } from "../git.js";
import { withBaseCommit } from "../sandbox/base-repo.js";
import { ATTENDED, isInsideFolder, main, USAGE } from "../sandbox/cli.js";
import { runSandboxJob } from "../sandbox/launcher.js";
import { masterFacts } from "../sandbox/master.js";
import { boundedNumber, budgetOverride, timeoutOverride } from "../sandbox/overrides.js";
import { gitVersionProblem } from "../sandbox/patches.js";
import { sandboxConfigSchema } from "../sandbox/sandbox-config.js";
import { MAX_BUDGET_USD, MAX_TIMEOUT_MINUTES, parseTask } from "../task.js";
import { FakeApi, PROJECT_RULES } from "./fake-api.js";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("the example config", () => {
  it("is valid JSON that the sandbox CLI's own schema accepts", async () => {
    // The only example left: the retired local lane's config went with it.
    const config = sandboxConfigSchema.parse(JSON.parse(await readFile(path.join(PACKAGE_DIR, "sandbox.config.example.json"), "utf8")));
    expect(config.keyDir).toBe("%USERPROFILE%\\.credit-runner-keys");
    expect(config.lane).toBe("sandbox");
    expect(config.laneCapUsd).toBeLessThanOrEqual(config.orgCapUsd);
  });
});

describe("the CLI's own words", () => {
  it("says in its usage that the launcher is run by hand and attended, with a neutral job label", () => {
    expect(ATTENDED).toContain("Run it by hand and attended until the night-shift conveyor's ledger v2 lands");
    expect(ATTENDED).toContain("Do not schedule or loop `sandbox run`");
    // What a signal does, and how a session a dead launcher left is found and booked.
    expect(ATTENDED).toContain("Ctrl-C, a kill or Ctrl-Break does\nthe same: it interrupts the session, waits for it or archives it, and books it");
    expect(ATTENDED).toContain("books the session at once at its whole budget as unknown and exits");
    expect(ATTENDED).toContain("`run`\nthen refuses, and `status` warns, until `sandbox collect <session-id> --book` books it");
    expect(ATTENDED).not.toMatch(/a launcher that dies or is started twice at once can\sleave a running session unrecorded/u);
    expect(USAGE).toContain("sandbox collect <session-id> --book [--budget <usd>]");
    expect(USAGE).toContain(ATTENDED);
    // No example that reads like a scheduled night.
    expect(USAGE).not.toMatch(/night-\d/u);
    expect(USAGE).toContain("e.g. trial-1");
  });

  it("prints the same words at the start of run, before it reads its config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "credit-runner-cli-"));
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    try {
      await expect(main(["run", "spec.md", "--job", "trial-1", "--config", path.join(root, "missing.json")])).rejects.toThrow(/ENOENT/u);
    } finally {
      spy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
    expect(written.join("")).toContain(ATTENDED);
  });

  it("refuses --night-cap, saying it was renamed to --job-cap, before it prints or reads anything", async () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    try {
      for (const flag of [["--night-cap", "5"], ["--night-cap=5"]]) {
        await expect(main(["run", "spec.md", "--job", "trial-1", ...flag, "--config", "missing.json"]), flag.join(" ")).rejects.toThrow(/^--night-cap was renamed to --job-cap/u);
      }
    } finally {
      spy.mockRestore();
    }
    expect(written).toEqual([]);
  });

  it("runs as the package's sandbox script runs it, in one node process with tsx's loader, also when started through a junction or a symlinked folder", async () => {
    // One process: tsx's own CLI would run the launcher as the child of a relay
    // parent, which Ctrl-Break or a closed window ends at once on Windows, and
    // the launcher with it, before its handlers have run.
    const manifest = JSON.parse(await readFile(path.join(PACKAGE_DIR, "package.json"), "utf8")) as { readonly scripts: Readonly<Record<string, string>> };
    const script = manifest.scripts.sandbox ?? "";
    expect(script).toBe("node --import tsx src/sandbox/cli-entry.ts");
    const [command, ...args] = script.split(" ");
    expect(command).toBe("node");
    const root = await mkdtemp(path.join(tmpdir(), "credit-runner-link-"));
    const link = path.join(root, "package");
    await symlink(PACKAGE_DIR, link, process.platform === "win32" ? "junction" : "dir");
    try {
      // From the package folder, as pnpm runs a script, here reached through the link: tsx and the entry are found through it.
      const child = spawnSync(process.execPath, [...args, "--help"], { cwd: link, encoding: "utf8", windowsHide: true });
      expect(child.status).toBe(0);
      expect(child.stdout).toContain(ATTENDED);
    } finally {
      await removeLink(link);
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("status", () => {
  it("names the git the review will use, and warns when it is older than the 2.41 the review needs", async () => {
    // git 2.41.0 brought --attr-source; an older git fails every review, after the run is paid for.
    for (const fine of ["git version 2.41.0", "git version 2.56.1\n", "git version 2.50.0.windows.1", "git version 3.0.0"]) expect(gitVersionProblem(fine), fine).toBeNull();
    for (const old of ["git version 2.40.1", "git version 2.9.5", "git version 1.99.0"]) {
      expect(gitVersionProblem(old), old).toMatch(/^git \d+\.\d+ is older than 2\.41, which the review needs for --attr-source/u);
    }
    expect(gitVersionProblem("not a version")).toMatch(/^could not read git's version/u);

    const root = await mkdtemp(path.join(tmpdir(), "credit-runner-status-"));
    const config = path.join(root, "sandbox.config.json");
    await writeFile(config, JSON.stringify({ workRoot: path.join(root, "work"), ledgerFile: path.join(root, "ledger.jsonl"), keyDir: path.join(root, "keys"), keyFile: "pot-1.key", lane: "sandbox", laneCapUsd: 1, orgCapUsd: 2 }));
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    try {
      expect(await main(["status", "--config", config])).toBe(0);
    } finally {
      spy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
    expect(written.join("")).toMatch(/^Git: \d+\.\d+\S* \(the review needs 2\.41 or newer\)$/mu);
  });
});

describe("status and collect --book, with a session the ledger lacks", () => {
  it("status names a lane session no ledger line charges and the command that books it; collect --book books it once, then adds nothing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "credit-runner-unbooked-"));
    const config = path.join(root, "sandbox.config.json");
    const ledgerFile = path.join(root, "ledger.jsonl");
    await writeFile(config, JSON.stringify({ workRoot: path.join(root, "work"), ledgerFile, keyDir: path.join(root, "keys"), keyFile: "pot-1.key", lane: "sandbox", laneCapUsd: 10, orgCapUsd: 20 }));
    const api = new FakeApi([]);
    api.statuses = ["running"];
    api.sessionBudget = { type: "limit", max_list_cost: { amount: "450", currency: "USD" } };
    api.earlierSessions = [
      { id: "sesn_lost", status: "running", metadata: { lane: "sandbox", job: "trial-1", task: "x", run: "run-lost" } },
      { id: "sesn_night", status: "running", metadata: { lane: "shift", job: "night-1", task: "y", run: "run-night" } },
    ];
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    const said = (): string => written.splice(0).join("");
    try {
      expect(await main(["status", "--config", config], { api })).toBe(0);
      const status = said();
      expect(status).toContain(
        "Warning: session sesn_lost (running) was made by this lane and has no ledger line; if a launcher is still following it, let that launcher finish (it books the session when it stops); otherwise book it with pnpm --filter @omnitwin/credit-runner sandbox collect sesn_lost --book; run refuses until it is booked",
      );
      // The shift's sessions are not this lane's to book.
      expect(status).not.toContain("sesn_night");
      expect(status).not.toContain("sesn_other");

      expect(await main(["collect", "sesn_lost", "--book", "--config", config], { api })).toBe(0);
      expect(said()).toBe("booked session sesn_lost at $4.50 (unknown, as it has not stopped: counted at its whole budget, or the last figure if higher)\n");
      expect(await main(["collect", "sesn_lost", "--book", "--config", config], { api })).toBe(0);
      expect(said()).toBe("the ledger already has a line for session sesn_lost; nothing was added\n");
      expect(JSON.parse((await readFile(ledgerFile, "utf8")).trim())).toMatchObject({ batchId: "sesn_lost", runId: "run-lost", job: "trial-1:x", costUsd: 4.5, costKnown: false });

      expect(await main(["status", "--config", config], { api })).toBe(0);
      expect(said()).toMatch(/^Unbooked sessions: none of lane 'sandbox' since \d{4}-\d\d-\d\dT/mu);
      // Without a usable key, status says it could not look.
      expect(await main(["status", "--config", config])).toBe(0);
      expect(said()).toContain(`Unbooked sessions: not checked (no key file at ${path.join(root, "keys", "pot-1.key")})`);
      // collect needs a session id, and either --book or the review's arguments.
      await expect(main(["collect", "--config", config], { api })).rejects.toThrow(/or <session-id> --book to book the session alone$/u);
      await expect(main(["collect", "sesn_lost", "--config", config], { api })).rejects.toThrow(/^collect needs <session-id> <spec\.md>/u);
    } finally {
      spy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("the launcher in a process of its own (launcher-child.ts, started as the sandbox script starts the CLI)", () => {
  const CHILD = path.join("src", "__tests__", "launcher-child.ts");
  const task = parseTask(["---", "id: next-task", "title: The next run", "budget_usd: 4.5", "timeout_minutes: 60", 'acceptance: "true"', "---", "Next."].join("\n"), "next-task.md");

  /** A child's output as it arrives, when it has printed a line, and when it has ended. */
  function watch(child: ChildProcess) {
    const seen = { stdout: "", stderr: "" };
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      seen.stdout += chunk;
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      seen.stderr += chunk;
    });
    const ended = new Promise<void>((resolve) => {
      child.on("close", () => {
        resolve();
      });
    });
    const printed = async (line: string): Promise<void> => {
      for (const deadline = Date.now() + 240_000; !seen.stdout.includes(line); ) {
        if (child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) {
          throw new Error(`the child did not print ${JSON.stringify(line)}: ${seen.stdout}${seen.stderr}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    return { seen, ended, printed };
  }

  /** Every ledger line, parsed; none when the file does not exist. */
  async function ledgerLines(file: string): Promise<Record<string, unknown>[]> {
    if (!existsSync(file)) return [];
    return (await readFile(file, "utf8"))
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it.skipIf(process.platform === "win32")(
    "takes one Ctrl-C to its process group as one press, though a parent that passes it on as pnpm does delivers it twice: one interrupt, the platform's figure booked",
    async () => {
      const folder = await mkdtemp(path.join(tmpdir(), "credit-runner-press-"));
      // pnpm 9's lifecycle runner on a SIGINT (its procInterupt): send the child a SIGINT, and exit once it has ended. The script's one command is that child (`sh -c` execs it).
      const pnpmLike = [
        'const { spawn } = require("node:child_process");',
        `const child = spawn(process.execPath, ["--import", "tsx", ${JSON.stringify(CHILD)}, ${JSON.stringify(folder)}], { stdio: "inherit" });`,
        'process.once("SIGINT", () => { child.kill("SIGINT"); child.on("exit", () => process.exit()); });',
        'child.on("exit", (code) => process.exit(code ?? 1));',
      ].join("\n");
      // Detached: the parent leads a process group of its own, which the launcher joins, as a terminal's foreground job.
      const parent = spawn(process.execPath, ["-e", pnpmLike], { cwd: PACKAGE_DIR, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      const watched = watch(parent);
      try {
        await watched.printed("following\n");
        const group = parent.pid;
        if (group === undefined || group <= 1) throw new Error("the parent has no pid of its own");
        // One Ctrl-C: the terminal sends SIGINT to the whole group, the parent and the launcher alike.
        process.kill(-group, "SIGINT");
        await watched.ended;
        // The first-signal path: the platform's figure once the session stopped, not the whole budget booked at once.
        const lines = await ledgerLines(path.join(folder, "ledger.jsonl"));
        expect(lines).toEqual([expect.objectContaining({ batchId: "sesn_1", costUsd: 2.87 })]);
        expect(lines[0]).not.toHaveProperty("costKnown");
        // The second delivery did arrive, and was taken as the same press.
        expect(watched.seen.stderr).toContain("SIGINT again within 2 s of the first: the same press");
        expect(watched.seen.stdout.trim().split("\n").at(-1)).toBe(
          JSON.stringify({ outcome: "stopped by SIGINT: session sesn_1 has stopped; its cost was read, and the run stopped before its review; collect it to review what it left", interrupts: 1 }),
        );
      } finally {
        if (parent.exitCode === null && parent.signalCode === null && parent.pid !== undefined) process.kill(-parent.pid, "SIGKILL");
        await rm(folder, { recursive: true, force: true });
      }
    },
    300_000,
  );

  const OTHER_SESSION_LINE = `${JSON.stringify({ ts: "2026-11-25T09:00:00.000Z", lane: "sandbox", job: "trial-1:x", model: "m", requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 1, batchId: "sesn_old" })}\n`;
  for (const [ledgerKind, ledgerText] of [
    ["a ledger that has a line", OTHER_SESSION_LINE],
    ["no ledger file", null],
    ["an empty ledger file", ""],
  ] as const) {
    it(`books a session whose launcher was killed outright mid-session at the next start, with ${ledgerKind}: run refuses naming it, status names it, collect --book books it once, then run passes the check`, async () => {
      const folder = await mkdtemp(path.join(tmpdir(), "credit-runner-killed-"));
      const ledgerFile = path.join(folder, "ledger.jsonl");
      if (ledgerText !== null) await writeFile(ledgerFile, ledgerText);
      const child = spawn(process.execPath, ["--import", "tsx", CHILD, folder], { cwd: PACKAGE_DIR, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const watched = watch(child);
      const written: string[] = [];
      const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });
      const said = (): string => written.splice(0).join("");
      try {
        await watched.printed("following\n");
        // No handler runs: SIGKILL on Linux and macOS, TerminateProcess on Windows.
        child.kill("SIGKILL");
        await watched.ended;
        expect(existsSync(ledgerFile) ? await readFile(ledgerFile, "utf8") : null).toBe(ledgerText);

        // The platform as the next start finds it: the session the killed launcher made runs on.
        const api = new FakeApi([]);
        api.persistFile = path.join(folder, "sessions.jsonl");
        api.statuses = ["running"];
        const runId = (JSON.parse((await readFile(api.persistFile, "utf8")).trim()) as { readonly metadata: { readonly run: string } }).metadata.run;
        const config = { workRoot: path.join(folder, "work"), ledgerFile, lane: "sandbox", laneCapUsd: 110, orgCapUsd: 190 };
        const next = (signal?: AbortSignal) =>
          runSandboxJob({ api, config, task, job: "next", budgetUsd: 4.5, timeoutMinutes: 60, baseSha: "b".repeat(40), projectRules: PROJECT_RULES, verifyScript: "// verify", signal });
        const advice =
          "session sesn_1 (running) was made by this lane and has no ledger line; if a launcher is still following it, let that launcher finish (it books the session when it stops); otherwise book it with pnpm --filter @omnitwin/credit-runner sandbox collect sesn_1 --book";
        expect(await next()).toMatchObject({ kind: "skipped", reason: expect.stringContaining(advice) });
        expect(api.sessions).toHaveLength(0);

        const configFile = path.join(folder, "sandbox.config.json");
        await writeFile(configFile, JSON.stringify({ ...config, keyDir: path.join(folder, "keys"), keyFile: "pot-1.key" }));
        expect(await main(["status", "--config", configFile], { api })).toBe(0);
        expect(said()).toContain(`Warning: ${advice}; run refuses until it is booked`);
        expect(await main(["collect", "sesn_1", "--book", "--config", configFile], { api })).toBe(0);
        expect(said()).toBe("booked session sesn_1 at $4.50 (unknown, as it has not stopped: counted at its whole budget, or the last figure if higher)\n");
        expect(await main(["collect", "sesn_1", "--book", "--config", configFile], { api })).toBe(0);
        expect(said()).toBe("the ledger already has a line for session sesn_1; nothing was added\n");
        const charging = (await ledgerLines(ledgerFile)).filter((line) => line.batchId === "sesn_1" || line.runId === runId);
        expect(charging).toEqual([expect.objectContaining({ batchId: "sesn_1", runId, costUsd: 4.5, costKnown: false, job: "child:child-task" })]);

        // The check now passes: stopped just after it, before anything is set up or created.
        await expect(next(AbortSignal.abort("SIGTERM"))).rejects.toThrow("stopped by SIGTERM before a session was created; nothing was spent");
        expect(await main(["status", "--config", configFile], { api })).toBe(0);
        expect(said()).toMatch(/^Unbooked sessions: none of lane 'sandbox' since /mu);
      } finally {
        spy.mockRestore();
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      }
    }, 300_000);
  }
});

/** Removes a junction or symlink itself, never what it points at. */
async function removeLink(link: string): Promise<void> {
  if (process.platform === "win32") await rmdir(link);
  else await unlink(link);
}

describe("the key folder", () => {
  const REPO_ROOT = path.resolve(PACKAGE_DIR, "../..");

  it("refuses a key folder inside the repository, before any key is read, and follows a junction to find out", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "credit-runner-keys-"));
    const link = path.join(root, "into-repo");
    await symlink(path.join(REPO_ROOT, "tools"), link, process.platform === "win32" ? "junction" : "dir");
    const configWith = async (keyDir: string): Promise<string> => {
      const file = path.join(root, "sandbox.config.json");
      await writeFile(file, JSON.stringify({ workRoot: path.join(root, "work"), ledgerFile: path.join(root, "ledger.jsonl"), keyDir, keyFile: "pot-1.key", lane: "sandbox", laneCapUsd: 1, orgCapUsd: 2 }));
      return file;
    };
    const quiet = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      for (const command of ["setup", "run", "collect"]) {
        await expect(main([command, "--config", await configWith(path.join(REPO_ROOT, "keys"))]), command).rejects.toThrow(/inside the repository/u);
      }
      // A folder that only reaches the repository through a junction is inside it too.
      await expect(main(["setup", "--config", await configWith(path.join(link, "keys"))])).rejects.toThrow(/inside the repository/u);
      // Outside it, setup goes on to look for the key file.
      await expect(main(["setup", "--config", await configWith(path.join(root, "keys"))])).rejects.toThrow(/no key file at/u);
    } finally {
      quiet.mockRestore();
      await removeLink(link);
      await rm(root, { recursive: true, force: true });
    }
    expect(isInsideFolder(path.join(REPO_ROOT, "keys"), REPO_ROOT)).toBe(true);
    expect(isInsideFolder(REPO_ROOT, REPO_ROOT)).toBe(true);
    expect(isInsideFolder(`${REPO_ROOT}-keys`, REPO_ROOT)).toBe(false);
    expect(isInsideFolder(path.dirname(REPO_ROOT), REPO_ROOT)).toBe(false);
    // A child whose first segment merely starts with two dots is inside; ".." and "../x" are not.
    expect(isInsideFolder(path.join(REPO_ROOT, "..keys"), REPO_ROOT)).toBe(true);
    expect(isInsideFolder(path.join(REPO_ROOT, "..keys", "pot-1.key"), REPO_ROOT)).toBe(true);
    expect(isInsideFolder(path.join(REPO_ROOT, "..", "keys"), REPO_ROOT)).toBe(false);
    expect(isInsideFolder(path.join(path.dirname(REPO_ROOT), "..keys"), REPO_ROOT)).toBe(false);
    // path.relative gives an absolute path when the child is on another drive.
    if (process.platform === "win32") {
      const otherDrive = REPO_ROOT.slice(0, 1).toUpperCase() === "Z" ? "Y:/keys" : "Z:/keys";
      expect(isInsideFolder(otherDrive, REPO_ROOT)).toBe(false);
    }
  });

  it.runIf(process.platform === "win32")("setup-keys.ps1 refuses a key folder inside the repository before it asks for a key", async () => {
    // Run a copy placed at tools/credit-runner/ of a temporary tree, so a regression that
    // creates and locks the folder does it there, never in this checkout.
    const root = await mkdtemp(path.join(tmpdir(), "credit-runner-setup-keys-"));
    try {
      const folder = path.join(root, "tools", "credit-runner");
      await mkdir(folder, { recursive: true });
      await cp(path.join(PACKAGE_DIR, "setup-keys.ps1"), path.join(folder, "setup-keys.ps1"));
      const args = ["-NoProfile", "-NonInteractive", "-File", path.join(folder, "setup-keys.ps1"), "-KeyDir", "keys-test-refused"];
      let child = spawnSync("pwsh", args, { cwd: root, encoding: "utf8", windowsHide: true });
      if (child.error !== undefined) child = spawnSync("powershell", args, { cwd: root, encoding: "utf8", windowsHide: true });
      expect(child.status).not.toBe(0);
      expect(`${child.stdout}${child.stderr}`).toContain("inside the repository");
      expect(existsSync(path.join(root, "keys-test-refused"))).toBe(false);
      expect(existsSync(path.join(REPO_ROOT, "keys-test-refused"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("keeps key files out of git, in the package and at the repository root", () => {
    for (const file of ["keys/pot-1.key", "tools/credit-runner/pot-1.key"]) {
      expect(spawnSync("git", ["-C", REPO_ROOT, "check-ignore", "-q", file], { env: gitEnv() }).status, file).toBe(0);
    }
  });
});

describe("--budget and --timeout overrides", () => {
  it("leave an absent flag alone and accept values up to the spec's limits", () => {
    expect(budgetOverride(undefined)).toBeUndefined();
    expect(timeoutOverride(undefined)).toBeUndefined();
    expect(budgetOverride(String(MAX_BUDGET_USD))).toBe(MAX_BUDGET_USD);
    expect(budgetOverride("0.5")).toBe(0.5);
    expect(timeoutOverride(String(MAX_TIMEOUT_MINUTES))).toBe(MAX_TIMEOUT_MINUTES);
    expect(timeoutOverride("1")).toBe(1);
  });

  it("refuse a typo that would pass the spec's ceiling", () => {
    expect(() => budgetOverride("450")).toThrow(/--budget must be at most 50/u);
    expect(() => budgetOverride(String(MAX_BUDGET_USD + 0.01))).toThrow(/at most/u);
    expect(() => timeoutOverride(String(MAX_TIMEOUT_MINUTES + 1))).toThrow(/--timeout must be at most 240/u);
    // A timeout this long would overflow setTimeout and fire at once.
    expect(() => timeoutOverride("40000")).toThrow(/at most/u);
  });

  it("refuse zero, negative, non-numeric and, for the timeout, fractional values", () => {
    for (const bad of ["0", "-1", "abc", "NaN", "Infinity", ""]) {
      expect(() => budgetOverride(bad), bad).toThrow(/positive number/u);
      expect(() => timeoutOverride(bad), bad).toThrow(/positive number/u);
    }
    expect(() => timeoutOverride("1.5")).toThrow(/whole number/u);
  });

  it("leave --job-cap without a ceiling of its own", () => {
    expect(boundedNumber("1000", "--job-cap")).toBe(1000);
  });
});

/** git as production runs it (gitEnv: no GIT_* variable), so a test that sets GIT_* for the code under test does not redirect its own setup. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: gitEnv() }).trim();
}

describe("masterFacts", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "credit-runner-master-test-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads master's commit and AGENTS.md without writing anything into the checkout it runs from, whatever GIT_* says", async () => {
    const origin = path.join(root, "origin");
    git(root, "init", "--quiet", "-b", "master", origin);
    git(origin, "config", "user.email", "t@example.com");
    git(origin, "config", "user.name", "T");
    git(origin, "config", "core.autocrlf", "false");
    // Trees only, as from GitHub: AGENTS.md is fetched when it is read.
    git(origin, "config", "uploadpack.allowFilter", "true");
    await writeFile(path.join(origin, "AGENTS.md"), "# Rules\n\nKeep tests green.\n\nDeploy to production when done.\n");
    git(origin, "add", ".");
    git(origin, "commit", "--quiet", "-m", "base");
    const sha = git(origin, "rev-parse", "HEAD");

    // The checkout the CLI is run from: a clone whose refs and FETCH_HEAD must not move.
    const clone = path.join(root, "clone");
    git(root, "clone", "--quiet", pathToFileURL(origin).href, clone);
    const before = { refs: git(clone, "for-each-ref"), gitDir: (await readdir(path.join(clone, ".git"))).sort() };
    const previous = process.cwd();
    // As from inside one of the checkout's own hooks: these would point every git call at it.
    const inherited = { GIT_DIR: path.join(clone, ".git"), GIT_WORK_TREE: clone, GIT_INDEX_FILE: path.join(clone, ".git", "index") };
    Object.assign(process.env, inherited);
    process.chdir(clone);
    try {
      const facts = await masterFacts(pathToFileURL(origin).href);
      expect(facts.baseSha).toBe(sha);
      expect(facts.projectRules).toContain("Keep tests green.");
      expect(facts.projectRules).not.toMatch(/deploy/iu);
    } finally {
      process.chdir(previous);
      for (const key of Object.keys(inherited)) Reflect.deleteProperty(process.env, key);
    }
    expect(git(clone, "for-each-ref")).toBe(before.refs);
    expect((await readdir(path.join(clone, ".git"))).sort()).toEqual(before.gitDir);
    await expect(readFile(path.join(clone, ".git", "FETCH_HEAD"), "utf8")).rejects.toThrow();
  });

  it("returns its result even when the throwaway repository cannot be removed, and says so", async () => {
    const origin = path.join(root, "origin");
    git(root, "init", "--quiet", "-b", "master", origin);
    git(origin, "config", "user.email", "t@example.com");
    git(origin, "config", "user.name", "T");
    await writeFile(path.join(origin, "AGENTS.md"), "# Rules\n");
    git(origin, "add", ".");
    git(origin, "commit", "--quiet", "-m", "base");
    const sha = git(origin, "rev-parse", "HEAD");
    const logged: string[] = [];
    const folders: string[] = [];
    const value = await withBaseCommit(
      pathToFileURL(origin).href,
      sha,
      (repo) => git(repo, "show", `${sha}:AGENTS.md`).length > 0 ? Promise.resolve("the result") : Promise.resolve("empty"),
      (line) => logged.push(line),
      (folder) => {
        folders.push(folder);
        return Promise.reject(new Error("EBUSY: resource busy or locked"));
      },
    );
    expect(value).toBe("the result");
    expect(logged).toEqual(["Could not remove a throwaway repository (EBUSY: resource busy or locked)."]);
    for (const folder of folders) await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it("fails when the repository has no master", async () => {
    const empty = path.join(root, "empty");
    git(root, "init", "--quiet", "--bare", empty);
    await expect(masterFacts(pathToFileURL(empty).href)).rejects.toThrow(/could not read master/u);
  });
});
