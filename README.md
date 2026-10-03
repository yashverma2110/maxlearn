# maxlearn

**Learn from the work you already do.** maxlearn is a [Claude Code](https://claude.com/claude-code) mod that sits beside your chat as a study companion. It watches the topics your conversations touch, teaches you the ideas behind them in short lessons, turns those lessons into flashcards, and schedules reviews with spaced repetition, so what you learn while shipping stays with you.

## How it helps

Most engineering knowledge is picked up in passing: a fix for a Redis eviction bug, a Postgres index that finally made a query fast. A week later it's gone. maxlearn catches those moments and brings them back at the right time.

1. **Learn, then recall.** New material arrives as a lesson (the idea, why it matters, a concrete example). You read it, press **Next**, and only then does its flashcard enter your review. You're never tested on something you haven't seen.
2. **Review at the right time.** Each card comes back just before you'd forget it, scheduled by **FSRS** or **SM-2**.
3. **Grow where it counts.** Cards and lessons are aimed at your level per topic, and at the topics you actually use or want to grow in.

## Install

**Recommended:** add the [yashverma plugin marketplace](https://github.com/yashverma2110/claude-plugins) once, then install. In Claude Code:

```
/plugin marketplace add yashverma2110/claude-plugins
/plugin install maxlearn@yashverma
```

Or from a terminal:

```sh
claude plugin marketplace add yashverma2110/claude-plugins
claude plugin install maxlearn@yashverma
```

To update later: `/plugin marketplace update yashverma`.

<details>
<summary>Other ways to install</summary>

Straight from this repo (it is a marketplace too):

```
/plugin marketplace add yashverma2110/maxlearn
/plugin install maxlearn@maxlearn
```

From a clone, for one session (handy for development):

```sh
git clone https://github.com/yashverma2110/maxlearn.git
claude --plugin-dir ./maxlearn
```

Use one way only: two installs load two copies.
</details>

The pane docks beside the chat in terminals at least 144 columns wide; otherwise run `/study`. Your data lives in Claude Code's plugin store on your machine, so it carries across sessions.

## Getting started

### 1. Open the pane
After installing, start a session. In a terminal at least 144 columns wide the pane docks beside the chat; otherwise run `/study`. In the terminal, press `ctrl+x tab` to give the pane the keyboard and `esc` to give it back.

### 2. Tell it what you want to learn
The first time, a **welcome** screen asks two things:

1. **Interests:** pick topics from the suggestions, or type your own (for example `kafka`), then **Next**.
2. **Experience:** *New to this*, *Junior / mid*, *Senior* or *Staff+*. Every topic starts at this level. Then **Start learning**.

maxlearn writes your first two lessons right away; the line under the input shows `⟳ Writing lessons…` while it works. Changed your mind later? Add an interest with `/study <topic>`, change **Experience** in settings, or run `/study welcome` again.

### 3. Learn
The **learn** tab (`e`) shows one lesson at a time: the idea, why it matters, and an example.

- **Next** (`enter`) adds the lesson's cards to your review. Their first review comes 10 minutes later.
- **Skip** (`n`) moves on without adding anything.
- **Simplify** (`z`) rewrites the lesson in simpler words. Later lessons on that topic start a level lower.
- **Don't know a word?** Press one of the **New words?** chips under the lesson (like `MVCC?`), paste any term into **Explain**, or, in the fullscreen terminal, select it with the mouse and press `w`. A short lesson on that term opens right away, and you return to the lesson you were reading.

You can also learn in the chat: `/study learn` posts a lesson with the same **Next** and **Simplify** buttons.

### 4. Review
When cards are due, the **review** tab (`r`) shows them one at a time.

1. Read the question and recall the answer in your head.
2. Press `s` to show the answer.
3. Grade yourself honestly: `1` again · `2` hard · `3` good · `4` easy, or move with `j` `l` and press `enter`. Each button shows when the card comes back.

Graded wrong by mistake? `u` undoes it. A bad card? `d` drops it for good. Prefer multiple choice? Use **quiz** (`q`).

Don't fully get a card? Press **Teach me** (`t`) after revealing it, or after answering a quiz question: a lesson on the idea behind it opens, and **Next** brings you back.

Nothing due? The empty review and quiz offer one chip per topic: **+ postgres** writes 3 flashcards (you learn them first) or 3 quiz questions (ready right away).

### 5. Keep going
- **Just work as usual.** Every few turns maxlearn checks your chat; if you worked something out, it makes cards from it. Pure command-running makes none.
- **A few minutes a day** beats a long session once a week. The status line shows `📚 3 due · 🔥 5`, your due cards and streak.
- **Check insights** (`p`) now and then: what to improve, what you're strong in, your recent chats, and where your time goes.
- **Tune it in settings** (`o`): models, focus (daily work or interests), FSRS, automatic cards, and the takeaways line.

Press `h` in the pane for every key. `/study tips` lists tips for your current state.

## Features

### Teaching from your chats
- Every few turns, maxlearn reads the conversation and names the engineering topics it touched. Ideas worth keeping long-term become cards; anything specific to one codebase is skipped.
- **Learning gate:** a cheap check first asks whether those turns explained anything reusable. Turns that only executed tasks (running commands, renaming, committing, formatting) still count toward your topics and time, but make no cards.
- `/study chat` does this right away.

### Teaching from your interests
- `/study <topic>` adds an interest, such as `/study redis` or `/study system design`.
- Interests get new material **automatically**: when a chat touches one (at most every 4h), and once per period (default **24h**, configurable).

### Personalised cards and lessons
- **Level adapts per topic:** every topic starts at your chosen experience, steps down a level if your recall is poor, and up a level once you've mastered it. **Simplify** on a lesson steps that topic down too.
- **Quality rubric:** one specific idea per card, about mechanisms, trade-offs and failure modes, never definitions. Generic questions are filtered out, and the model sees your existing cards so it goes deeper instead of repeating.
- **Plain language:** cards follow ASD-STE100 Simplified Technical English (short sentences, active voice, one idea each).
- **Focus setting:** *daily work*, *balanced* or *my interests* decides which topics come first in review, which weak topics are flagged and what gets suggested.

### Learning screen and lessons in chat
- **learn tab:** your unseen cards with their answers first (free), then written lessons. Each lesson carries 1–2 cards that test exactly what it taught.
- **`/study learn`:** a lesson card right in the conversation. **Next** swaps the next lesson into the same row.
- **Low token cost:** one model call writes **two** lessons, one for now and one for your next Next.
- **Explain a term:** each lesson lists the terms you may not know. One press writes a short lesson on the term, in the context of its topic, and files it as a **subtopic** (postgres → DDL, MVCC). Insights → topics lists your subtopics, with `+` to go deeper.

### Review and quiz
- **review:** reveal the answer, then grade it *again / hard / good / easy*. Each button shows when the card will come back (`good · 4d`).
- **quiz:** multiple choice; your answer grades the card.
- **Teach me** (`t`): a lesson on the idea behind any flashcard or quiz question, then back to where you were.
- **Empty states make more:** one chip per topic writes 3 flashcards, or 3 quiz questions that are ready immediately (a quiz is a fine first look: you see the answer right after you pick).
- **Corrections:** `u` undoes a grade (and removes it from your stats); `d` drops a bad card for good.
- **Takeaways:** the line under the input shows a short takeaway from a card you've already reviewed. It never shows a card that's due, so it can't give away a test.

### Insights
| View | Shows |
|---|---|
| **overview** | streak, recall over 30 days, mature cards, a 12-week review heat map, and your interests as chips (press one for 2 new lessons on it) |
| **topics** | **subtopics you explored**, **topics that need more review** (weakest first, with the reason), strong topics, your interests, and **time spent per topic** in chat, review and learning |
| **work** | topics from the last 7 days of chat, how many days each came up, and `+3 cards` for topics with too few cards |
| **chats** | **which topics came up in which chats**, and how long each chat spent on each |

`/study stats` prints the same as text.

### Settings
| Setting | Options |
|---|---|
| Chat model | session model (cached, cheapest), opus, sonnet, haiku |
| Interest / lesson model | opus, **sonnet**, haiku |
| Experience | new to this, junior / mid, **senior**, staff+ |
| Focus | daily work, **balanced**, my interests |
| Scheduler | **SM-2**, FSRS (with target recall 85% / **90%** / 95%) |
| Auto cards | each interest every off / 12h / **24h** / 3 days / week; on chat touch **on** / off; cards from chat **on** / off |
| Takeaways | off / **every 30s** / every 2m |
| Start over | deletes all cards, reviews, lessons, interests and history (asks to confirm), keeps settings, and opens the welcome screen |

### Spaced repetition: FSRS and SM-2
- **FSRS-4.5** (Free Spaced Repetition Scheduler) models each card's memory as *stability* and *difficulty*, then plans the next review for when your chance of recall drops to your target. Cards scheduled by SM-2 carry over when you switch.
- **SM-2** is the classic rule: each good grade multiplies the interval by the card's ease.

### Keyboard first
| Keys | Do |
|---|---|
| `i` `j` `k` `l` | move the highlight, like ↑ ← ↓ → |
| `enter` | press the highlighted button |
| `s` | reveal the answer |
| `1` `2` `3` `4` | grade again / hard / good / easy |
| `a`–`d` | pick a quiz choice |
| `n` / `u` / `d` | skip / undo / drop |
| `t` / `z` / `w` | teach me / simplify / explain the selected word |
| `e r q p m o` | learn, review, quiz, insights, more, settings |
| `h` / `esc` | show all keys / close the pane |

## Commands
| Command | Does |
|---|---|
| `/study` | open the pane |
| `/study welcome` | the welcome screen: interests and experience |
| `/study <topic>` | add an interest and write its first cards |
| `/study learn` | a lesson in the chat |
| `/study review` · `/study quiz` | open the pane with the keyboard on it |
| `/study chat` | make cards from this chat now |
| `/study stats` · `/study tips` | progress / tips as text |

## What it uses

maxlearn runs with the same access as Claude Code, like every mod. Here is what it does with it:

| It uses | When | Turn it off |
|---|---|---|
| **Model calls on your account** | Every 3 turns, one small Haiku call (the learning gate) reads only the new turns; if they taught something, a fork of the chat writes cards (prompt-cached by default) | settings → Auto cards → Cards from chat → off |
| | 2 lessons per call when you press **Next** with nothing queued, and per **Simplify** | only on your press |
| | 3 cards per interest each period (default 24h), and when a chat touches an interest (at most every 4h) | settings → Auto cards → period off, chat touch off |
| **Your chat transcript** | Read to name topics and write cards; sent nowhere except the model calls above | settings → Auto cards → Cards from chat → off |
| **Local storage** | Cards, reviews, lessons, settings and time per topic, in Claude Code's plugin store | delete the `maxlearn_*` file in `~/.claude/plugins/store/` |

It reads no files and runs no commands. Nothing leaves your machine except the model calls.

## Develop

```sh
claude plugin validate .
claude plugin test .     # 93 tests
```

The code is split into pure modules (`srs`, `fsrs`, `analytics`, `usage`, `lessons`, `prompts`, `keymap`, `layout`, `tips`, `auto`, `insight`) and one hooks module (`register.tsx`) that holds everything touching Claude Code's engine.

## License

[MIT](LICENSE)
