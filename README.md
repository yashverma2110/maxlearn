# maxlearn

**Learn from the work you already do.** maxlearn is a [Claude Code](https://claude.com/claude-code) mod that sits beside your chat as a study companion. It watches the topics your conversations touch, teaches you the ideas behind them in short lessons, turns those lessons into flashcards, and schedules reviews with spaced repetition, so what you learn while shipping stays with you.

## How it helps

Most engineering knowledge is picked up in passing: a fix for a Redis eviction bug, a Postgres index that finally made a query fast. A week later it's gone. maxlearn catches those moments and brings them back at the right time.

1. **Learn, then recall.** New material arrives as a lesson (the idea, why it matters, a concrete example). You read it, press **Next**, and only then does its flashcard enter your review. You're never tested on something you haven't seen.
2. **Review at the right time.** Each card comes back just before you'd forget it, scheduled by **FSRS** or **SM-2**.
3. **Grow where it counts.** Cards and lessons are aimed at your level per topic, and at the topics you actually use or want to grow in.

## Features

### Teaching from your chats
- Every few turns, maxlearn reads the conversation and names the engineering topics it touched. Ideas worth keeping long-term become cards; anything specific to one codebase is skipped.
- `/study chat` does this right away.

### Teaching from your interests
- `/study <topic>` adds an interest, such as `/study redis` or `/study system design`.
- Interests get new material **automatically**: when a chat touches one (at most every 4h), and once per period (default **24h**, configurable).

### Personalised cards and lessons
- **Level adapts per topic:** a new topic starts at senior level, steps down to mid-level if your recall is poor, and up to staff level once you've mastered it.
- **Quality rubric:** one specific idea per card, about mechanisms, trade-offs and failure modes, never definitions. Generic questions are filtered out, and the model sees your existing cards so it goes deeper instead of repeating.
- **Plain language:** cards follow ASD-STE100 Simplified Technical English (short sentences, active voice, one idea each).
- **Focus setting:** *daily work*, *balanced* or *my interests* decides which topics come first in review, which weak topics are flagged and what gets suggested.

### Learning screen and lessons in chat
- **learn tab:** your unseen cards with their answers first (free), then written lessons. Each lesson carries 1–2 cards that test exactly what it taught.
- **`/study learn`:** a lesson card right in the conversation. **Next** swaps the next lesson into the same row.
- **Low token cost:** one model call writes **two** lessons, one for now and one for your next Next.

### Review and quiz
- **review:** reveal the answer, then grade it *again / hard / good / easy*. Each button shows when the card will come back (`good · 4d`).
- **quiz:** multiple choice; your answer grades the card.
- **Corrections:** `u` undoes a grade (and removes it from your stats); `d` drops a bad card for good.
- **Takeaways:** the line under the input shows a short takeaway from a card you've already reviewed. It never shows a card that's due, so it can't give away a test.

### Insights
| View | Shows |
|---|---|
| **overview** | streak, recall over 30 days, mature cards, a 12-week review heat map |
| **topics** | **topics that need more review** (weakest first, with the reason), strong topics, your interests, and **time spent per topic** in chat, review and learning |
| **work** | topics from the last 7 days of chat, how many days each came up, and `+3 cards` for topics with too few cards |
| **chats** | **which topics came up in which chats**, and how long each chat spent on each |

`/study stats` prints the same as text.

### Settings
| Setting | Options |
|---|---|
| Chat model | session model (cached, cheapest), opus, sonnet, haiku |
| Interest / lesson model | opus, **sonnet**, haiku |
| Focus | daily work, **balanced**, my interests |
| Scheduler | **SM-2**, FSRS (with target recall 85% / **90%** / 95%) |
| Auto cards | each interest every off / 12h / **24h** / 3 days / week; on chat touch on / off |
| Takeaways | off / **every 30s** / every 2m |

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
| `e r q p m o` | learn, review, quiz, insights, more, settings |
| `h` / `esc` | show all keys / close the pane |

## Commands
| Command | Does |
|---|---|
| `/study` | open the pane |
| `/study <topic>` | add an interest and write its first cards |
| `/study learn` | a lesson in the chat |
| `/study review` · `/study quiz` | open the pane with the keyboard on it |
| `/study chat` | make cards from this chat now |
| `/study stats` · `/study tips` | progress / tips as text |

## Run it

```sh
git clone git@github.com:yashverma2110/maxlearn.git
claude --plugin-dir ./maxlearn
```

The pane docks beside the chat in terminals at least 144 columns wide; otherwise run `/study`. Your data lives in Claude Code's plugin store, so it carries across sessions.

## Develop

```sh
claude plugin validate .
claude plugin test .     # 62 tests
```

The code is split into pure modules (`srs`, `fsrs`, `analytics`, `usage`, `lessons`, `prompts`, `keymap`, `layout`, `tips`, `auto`, `insight`) and one hooks module (`register.tsx`) that holds everything touching Claude Code's engine.
