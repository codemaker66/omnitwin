# HOW TO USE THE OMNITWIN SQUAD IN CLAUDE CODE

## Setup: The Project File Structure

In your OMNITWIN project root, create a `.claude/` directory:

```
omnitwin/
├── .claude/
│   ├── AI_INTEGRITY_RULES.md      ← Loaded in EVERY session (non-negotiable)
│   ├── SQUAD_PROTOCOL.md           ← Loaded for any engineering work
│   ├── squad/
│   │   ├── RENDERER.md
│   │   ├── INTERACTOR.md
│   │   ├── ARCHITECT.md
│   │   ├── FRONTENDER.md
│   │   ├── DEPLOYER.md
│   │   ├── TESTER.md
│   │   ├── DOCUMENTER.md
│   │   └── PERFKEEPER.md
│   ├── council/
│   │   ├── MR_MILLISECOND.md
│   │   ├── MS_CANVAS.md
│   │   ├── MR_HANDSHAKE.md
│   │   ├── MS_WEDGE.md
│   │   ├── MR_PIXEL.md
│   │   ├── MS_PRESENCE.md
│   │   ├── MR_SCAFFOLD.md
│   │   └── MR_COMPUTER.md
│   └── CLAUDE.md                   ← Claude Code project instructions (see below)
├── packages/
│   ├── types/
│   ├── web/
│   ├── api/
│   └── pdf/
└── ...
```

## The CLAUDE.md File (Claude Code Project Instructions)

Create this file at `.claude/CLAUDE.md` — Claude Code reads this automatically:

```markdown
# OMNITWIN — Claude Code Instructions

## Identity
You are an engineering specialist on the OMNITWIN project. You MUST read and follow
AI_INTEGRITY_RULES.md before doing any work. This is non-negotiable.

## Before Every Task
1. Confirm which Squad specialist you are operating as
2. State the specific task and its Definition of Done
3. Estimate the scope (files, lines, prompts needed)
4. If the task is too large for one prompt, break it down and state the plan

## During Every Task
- Follow the Seven Laws from AI_INTEGRITY_RULES.md
- Use the Anti-Patterns Checklist before claiming completion
- Write tests alongside implementation, not after
- If uncertain about any library API, flag it with // VERIFY:

## After Every Task
- Use the Handoff Protocol (COMPLETED / VERIFIED / UNVERIFIED / REMAINING / NEXT)
- If REMAINING is not empty, explicitly tell Blake what to prompt next
- Never let a session end with unfinished work unacknowledged

## Technology Stack (DO NOT DEVIATE)
- TypeScript strict mode (no `any`, no `as unknown as`)
- React + React Three Fiber (@react-three/fiber, @react-three/drei)
- Fastify (NOT Express, NOT NestJS)
- PostgreSQL via Drizzle ORM (NOT Prisma)
- Zustand for state management
- Vitest for testing
- Zod for runtime validation
- pnpm workspaces monorepo

## Quality Bar
This code will be evaluated by Jane Street engineers.
Every function, every type, every test must reflect that standard.
```

## How to Start a Claude Code Session

### For Renderer work (3D engine, shaders, LOD):
```
Read .claude/AI_INTEGRITY_RULES.md and .claude/squad/RENDERER.md.
You are Renderer. Today we're implementing [specific task].
```

### For a cross-cutting feature (e.g., configuration publish flow):
```
Read .claude/AI_INTEGRITY_RULES.md and .claude/SQUAD_PROTOCOL.md.
Today involves Architect, Renderer, Documenter, and Deployer.
We're implementing the configuration publish pipeline.
Start with Architect's perspective on the API route.
```

### For a code review:
```
Read .claude/AI_INTEGRITY_RULES.md and all squad files.
Full Squad review of [file/feature]. Each specialist comments from their domain.
```

## The Multi-Prompt Workflow for Large Tasks

Large features (like the drag-and-drop system) will take many prompts. Here's the workflow:

### Prompt 1: Planning
```
You are Interactor. We need to build the drag-and-drop furniture placement system.
DON'T write code yet. Break this into implementable chunks that each fit in one prompt.
List every function, every file, every test. Estimate prompt count.
```

### Prompt 2-N: Implementation (one chunk per prompt)
```
You are Interactor. Implementing chunk 2 of 8: the snap-to-floor raycasting system.
Here's the current code state: [paste relevant files or let Claude Code read them].
Implement this chunk fully with tests. Use the Handoff Protocol at the end.
```

### Prompt N+1: Integration Review
```
You are Perfkeeper reviewing Interactor's drag-and-drop system.
Read [all relevant files]. Check draw call impact, frame time budget, memory usage.
Flag any performance concerns.
```

### Prompt N+2: Test Review
```
You are Tester reviewing the drag-and-drop system.
Are all interaction paths tested? Are edge cases covered?
Write any missing tests.
```

## Guardrails That Catch AI Failure Modes

### Guardrail 1: The Compilation Check
After every code generation prompt, run:
```bash
pnpm typecheck    # TypeScript strict compilation
pnpm lint         # ESLint with strict rules
pnpm test         # Vitest test suite
```
If ANY of these fail, the code is not complete. Show the error to Claude and ask for the fix.
DO NOT accept "that should work" — run it and verify.

### Guardrail 2: The TODO Scan
Periodically run:
```bash
grep -r "TODO\|FIXME\|HACK\|XXX\|PLACEHOLDER\|implement\|skeleton" --include="*.ts" --include="*.tsx" packages/
```
Any result in non-test files is unfinished work. Don't let it accumulate.

### Guardrail 3: The Any Scan
```bash
grep -r ": any\|as any\|<any>" --include="*.ts" --include="*.tsx" packages/
```
Zero results. No exceptions. If TypeScript needs `any`, the types are wrong.

### Guardrail 4: The Coverage Check
```bash
pnpm test -- --coverage
```
Review coverage report. Any file below 70% needs more tests.
State machine files (@omnitwin/types) must be 95%+.

### Guardrail 5: The Bundle Size Check
```bash
pnpm build && du -sh packages/web/dist/
```
Track this number. If it grows by >500KB without a new feature, investigate.

### Guardrail 6: The Visual Verification
For ANY 3D or UI change, actually look at it in a browser.
Screenshot or describe what you see. Don't trust that the code is correct
just because it compiles — rendering bugs are logic bugs that pass type checks.

## When Things Go Wrong

### "The AI said it was done but the code doesn't compile"
1. Paste the EXACT error message into the next prompt
2. Say: "This code from the previous prompt doesn't compile. Here's the error. Fix it — don't rewrite from scratch, fix the specific issue."
3. Run the compilation check again after the fix

### "The AI generated skeleton code"
1. Paste the file with the skeleton functions
2. Say: "These functions are skeletons. Implement them fully per AI_INTEGRITY_RULES.md Law 1. Each function must have a complete implementation and a test."
3. Verify by reading the output — look for actual logic, not just type signatures

### "The AI changed the architecture without asking"
1. Say: "You changed [X] to [Y] without asking. The spec says [X]. Revert to the specified approach. If you believe [Y] is better, explain why and let me decide."
2. This is enforced by Law 7 of the Integrity Rules

### "The AI is getting confused in a long conversation"
1. Start a new Claude Code session
2. Load the integrity rules and relevant squad persona
3. Paste the specific files being worked on
4. State the specific remaining task
5. Continue from where you left off

## Session Hygiene

- **One feature per session.** Don't try to build the entire drag-and-drop system AND the hallkeeper PDF in the same conversation.
- **Load only relevant personas.** If you're doing Architect work, you don't need Renderer loaded (unless it's a cross-cutting task).
- **Save working code frequently.** After each successful prompt, commit to git. If a subsequent prompt breaks things, you can revert.
- **Trust but verify.** Claude is brilliant but fallible. Run the code. Check the output. Read the tests. The guardrails exist because they're needed.

---

*This guide should be updated as you develop patterns for what works and what doesn't in practice.*
