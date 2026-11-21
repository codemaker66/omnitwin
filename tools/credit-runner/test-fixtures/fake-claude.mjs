// Stand-in for `claude -p --bare --output-format stream-json`, used by night.test.ts.
// It reports what it was given (never a whole key), commits a file in its working
// directory, tries to push, and imitates the API's "credit balance too low" error
// whenever its key contains "broke".
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const sessionId = flag("--session-id") ?? flag("--resume") ?? "no-session";
const key = process.env.ANTHROPIC_API_KEY ?? "";
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;

if (process.env.FAKE_RECORD !== undefined) {
  appendFileSync(
    process.env.FAKE_RECORD,
    `${JSON.stringify({
      args,
      keyTail: key.slice(-6),
      hasBaseUrl: "ANTHROPIC_BASE_URL" in process.env,
      hasOauth: "CLAUDE_CODE_OAUTH_TOKEN" in process.env,
      configDir: process.env.CLAUDE_CONFIG_DIR ?? null,
      prompt: prompt.slice(0, 60),
    })}\n`,
  );
}

const emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
emit({
  type: "system",
  subtype: "init",
  apiKeySource: process.env.FAKE_API_KEY_SOURCE ?? (key === "" ? "none" : "ANTHROPIC_API_KEY"),
  model: flag("--model"),
  session_id: sessionId,
  tools: [],
});

if (process.env.FAKE_API_KEY_SOURCE !== undefined) {
  // A run on the wrong credential: the runner must kill it long before this ends.
  await new Promise((resolve) => setTimeout(resolve, 20000));
}

if (key.includes("broke")) {
  emit({
    type: "result",
    subtype: "success",
    is_error: true,
    result: "Credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
    total_cost_usd: 0,
    num_turns: 1,
    duration_ms: 4,
    session_id: sessionId,
  });
  process.exit(1);
}

const git = (...gitArgs) => execFileSync("git", gitArgs, { stdio: "pipe" }).toString();
if (prompt.includes("TOUCH_ENV")) {
  writeFileSync(".env.local", "SECRET=1\n");
  git("add", ".env.local");
  git("commit", "-m", "Add an env file");
} else {
  writeFileSync("hello.txt", "hello\n");
  git("add", "hello.txt");
  git("commit", "-m", "Add hello.txt");
}
let pushBlocked = false;
try {
  git("push", "origin", "HEAD");
} catch {
  pushBlocked = true;
}

emit({ type: "assistant", message: { content: [{ type: "text", text: "working" }] } });
emit({
  type: "result",
  subtype: "success",
  is_error: false,
  result: `Finished. push blocked: ${String(pushBlocked)}\n\n## Summary\nAdded one file.`,
  total_cost_usd: 0.12,
  num_turns: 3,
  duration_ms: 1500,
  session_id: sessionId,
  permission_denials: [{ tool_name: "Bash", tool_use_id: "toolu_1", tool_input: {} }],
});
