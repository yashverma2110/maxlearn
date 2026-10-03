# AGENTS.md: working on maxlearn

Context for an AI agent (or a person) picking up work on maxlearn in a new chat. Read this before changing code. The README is the user-facing doc; this file is how the code works and why.

## What it is

maxlearn is a **Claude Code mod**: a plugin made of function hooks (TypeScript, run by Claude Code's hooks engine, no Node, no DOM). It draws a sidebar pane that teaches from the user's chats and interests:

- **learn:** lessons first; a lesson's cards join review only when the user presses **Next**
- **review / quiz:** spaced repetition with SM-2 or FSRS-4.5
- **insights:** progress, weak and strong topics, subtopics, topics per chat, time per topic
- automatic generation: chat checks every 3 turns (behind a learning gate), a period per interest, and a chat touching an interest

Repo: https://github.com/yashverma2110/maxlearn (MIT). Marketplace repo: https://github.com/yashverma2110/claude-plugins (marketplace name `yashverma`).

## Layout

```
.claude-plugin/plugin.json        manifest (name, version, metadata, "types")
.claude-plugin/marketplace.json   this repo is also a marketplace (maxlearn@maxlearn)
hooks/hooks.json                  { "modules": ["./register.tsx"] }
hooks/register.tsx                THE hooks module: everything that touches `$`
hooks/keys.tsx                    Client surface module: the ⌨ key strip (forwards keys)
hooks/*.ts                        pure modules (no `$`), each with a *.test.ts
types/index.d.ts                  the state contract: types + `interface PluginState`
```

Pure modules: `srs` (SM-2, due cards, parsing cards, topic names), `fsrs` (FSRS-4.5), `analytics` (overview, topic insights, improve/strong, heat map, streaks), `usage` (chat sessions, time per topic), `lessons` (lesson parsing, learning, terms, prompts for Explain and Teach me), `prompts` (levels, card rubric, STE rules, Simplify prompt), `gate` (learning gate), `auto` (automatic interest timing), `insight` (status-line takeaways), `keymap` (key → action, hints, help), `layout` (density, labels, bars), `tips`, `constants` (settings defaults and option lists).

## Hard rules of the mod engine (the validator enforces them)

These cost real time to discover. Break one and `claude plugin validate` fails or the mod won't load.

1. **`$` never crosses an import.** The validator follows `$` only into functions declared in the same file. So every function that takes `$` lives in `register.tsx`. Pure logic goes in the other modules.
2. **`$` is never put in an object.** No `{ $, ... }` and no `fn({ $ })`. Pass it positionally: `fn($, args)`.
3. **State atoms are declared in `register.tsx`** with literal refs: `atom({ plugin: 'maxlearn', key: 'deck' } as const, ...)`. The scan can't read an atom imported from another file.
4. **Matchers use literals.** `on('ui.render', { component: 'Pane', requestId: PANE })` works only because `PANE` is a `const` literal in the same file.
5. **A render hook never writes state.** Writes happen in `onPress` and `onSubmit` handlers or other events. Module variables (not `$.state`) may be set while drawing.
6. **Every `$.state` key is declared** in `types/index.d.ts` under `PluginState['maxlearn']`. Don't name an exported type `Settings`: the engine exports one, and inside `declare module` it silently wins. Ours is `StudySettings`.
7. **No `import()`**, no Node APIs; `btoa` and the web globals exist.
8. **Literal widening:** `update($, view, v => ({ mode: 'learn', ... }))` fails to type-check. Annotate: `(v): View => (...)`.

## Hard-won UI facts

- **Arrow keys and Space never reach the pane.** The user's keybindings (Chat context: up/down = history, space = push-to-talk) take them first. So keys are letters: `i j k l` move like ↑ ← ↓ →, `enter` presses, `s` reveals, `1–4` grade, `t` teach me, `z` simplify, `w` explain the selected word, `n` skip, `u` undo, `d` drop, `h` help, `x` close, tabs `e r q p m o`. Arrows and Space reach only the ⌨ Client strip, and only after a mouse click.
- **Selected = bright, unselected = dim.** No `•` or other markers on tabs, sub-tabs or option buttons; the footer's key helper draws dim by default, so tabs pass `dimColor: mode !== v.mode`.
- **Module state the UI shows needs `$.ui.invalidate('ui.render')`** when it changes (the generation `queue`); `$.state` changes redraw on their own.
- **Every press that starts generation shows it in the pane at once** (spinner text, `⟳` on the chip, "Queued next"), not only on the status line.
- **No `Select` elements.** A focused Select keeps letter keys for itself, so tab hotkeys stop working. Pickers are rows of option buttons on every surface.
- **A hotkey must belong to exactly one drawn Button** ("later wins" otherwise). `keys.test.ts` has a test that fails on any duplicate in every pane state. Keep it passing.
- **The focus ring:** `ui.focus` hook refuses moves onto engine stops (keeps keys in the pane); `focusMain` puts the ring on the main button after each action; `moveRing` walks `ringOrder` (computed at draw time) for i/j/k/l off the card tabs.
- **Esc can't be caught.** Every `$.ui.open` passes `closeOnEscape: true`.
- **Footer differs per surface:** the terminal gets a rule plus an inverted-T key map, which aligns in monospace. Desktop, VS Code and mobile get one framed block, because a proportional font breaks drawn rules and space-padding.
- **Layout:** content on top (centered on study tabs with flexGrow spacers), footer pinned at the bottom via `minHeight = scroll.bodyRows`. Height-only resizes don't redraw.
- **The status line** is capped at 72 characters (`insight.ts` `statusLine`) and never shows a due card's answer.

## Product decisions (and why)

- **Learn before review:** `dueCards` excludes cards with `reps === 0 && learnedAt === undefined` (`isToLearn`). Only the learn tab's **Next** (or the chat row's Next) sets `learnedAt`. Skip never does. Exception: quiz questions made from the empty quiz state are ready at once, because answering one is its first exposure.
- **Token thrift:** one call writes **2 lessons** (one now, one queued). Free lessons (unseen cards) are shown before paid ones. Chat checks use the cached session fork. The **learning gate** (one Haiku call over only the turns since the last check) blocks execution-only turns from becoming cards but still records their topics and time. Every automatic call has a settings off switch: cards from chat, the auto period, auto on chat touch.
- **Quality:** a card rubric with bad and good examples, a local weak-question filter (`isWeakFront`), draft-6-keep-3 for interest cards, and ASD-STE100 rules on every text field (`STE_RULES` in `prompts.ts`).
- **Levels:** `intro < mid < senior < staff`. The start is the user's **Experience** setting; poor recall moves −1, mastery +1, each Simplify −1.
- **Generation is serialized:** `generate()` runs one model job at a time and queues the rest (deduped by label + noun). The spinner state is the `generating` atom.

## State

Session state (`$.state` atoms in `register.tsx`): `deck, interests, view, generating, settings, reviews, chatTopics, lastAnswer, session, lessons, lessonQueue, lessonNow, chatRuns, chatSessions, learnTime, subtopics`.

Persisted (`$.store`, file `~/.claude/plugins/store/maxlearn_*.json`): `deck, interests, settings, reviews, chatTopics, chatSessions, lessons, lessonQueue, learnTime, subtopics, autoAt, simpler, milestones, onboarded`. Loaded and migrated in the `session.start` hook. **Start over** (`resetAll`) deletes everything in `RESET_KEYS` and keeps `settings`. A new persisted key must be added to the `session.start` load and, unless it's a setting, to `RESET_KEYS`.

A new setting needs: the type in `StudySettings`, a default in `DEFAULT_SETTINGS` (old stores fall back through `{ ...DEFAULT_SETTINGS, ...saved }`), and a picker in `SettingsTab`.

## Developing

```sh
claude --plugin-dir ~/projects/maxlearn      # load and watch this folder for a session
claude plugin validate .claude-plugin/plugin.json --strict   # plugin + hooks
claude plugin validate . --strict            # with marketplace.json present, checks the marketplace
claude plugin test .                         # all *.test.ts (94 at 0.4.1)
tsc -p .                                     # once the plugin has loaded once (it writes .claude-plugin/types/)
```

Caveat: a session's dev-mods folder (`~/.claude/dev-mods/<session>/`) hot-reloads only real folders. A **symlink** into it loads once and doesn't pick up later edits; recreate the link to reload. Prefer `--plugin-dir`, or `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` `env`, which loads in every session. Don't also install it from a marketplace, or two copies load.

### Testing gotchas (`claude-code/testing`)

- Nothing sits beneath the plugin in a test. Stub every engine call the code path makes: `session.start` (returns `{ cwd }`), `command.register`, `ui.status`, `ui.toast`, `ui.open`, `ui.focus`, `model.complete`, `model.fork`, `session.messages`, `session.id`, `session.cwd`, `ui.selection`, `turn.complete` (returns `{ text }`).
- **Calls on `$` answer with a `{ value }` envelope** (`{ value: { isAnswered: true as const, text, usage } }`). Event hooks (`session.start`, `turn.complete`, `ui.focus`) answer plain.
- `mock.clock(on)` **starts at 0**. Advance in small steps (`clock.advance(10)` a few times) to let queued `$.clock.after(0)` work run.
- `ui.mount` for a Pane needs full props: `{ title, isFocused, bodyColumns, placement, scroll: { offset, bodyRows }, view }`.
- The kit can't run the plugin's own `$.ui.focus` moves, so test focus logic through the pure `focusOrder` / `ringStep` / `mainElement`.
- No `toBeCloseTo`: compare rounded numbers.
- Fixture cards need `learnedAt: 0` to be reviewable.

## Releasing

1. Bump `version` in `.claude-plugin/plugin.json`: minor for features, patch for fixes.
2. `claude plugin validate . --strict`, `claude plugin validate .claude-plugin/plugin.json --strict`, `claude plugin test .` all pass; update the test count in the README.
3. Commit and push `main`.
4. In `~/projects/claude-plugins`: set maxlearn's `version` in `.claude-plugin/marketplace.json` to match, validate `--strict`, commit and push.
5. Verify a real install without touching your own config:
   ```sh
   T=$(mktemp -d); CLAUDE_CONFIG_DIR=$T claude plugin marketplace add yashverma2110/claude-plugins
   CLAUDE_CONFIG_DIR=$T claude plugin install maxlearn@yashverma && CLAUDE_CONFIG_DIR=$T claude plugin list; rm -rf $T
   ```
6. Optional: `gh release create vX.Y.Z` with notes (install commands at the top).

Users update with `/plugin marketplace update yashverma`. The official directory (claude.ai/directory/manage) needs a paid plan and hasn't been submitted.

Agent context lives in `AGENTS.md`, imported by `.claude/CLAUDE.md`. A `CLAUDE.md` at the repo root would fail `validate --strict`, because it's the plugin root.

## Conventions

- Match the existing style: short doc comments that say *why*, small pure helpers, `rep`-style surgical edits over rewrites.
- Every behaviour change gets a test, ideally one that fails without the change.
- Commits end with a `Co-Authored-By` trailer for the agent that helped.
- User-facing text in prompts and lessons follows ASD-STE100; UI copy is short and plain.
