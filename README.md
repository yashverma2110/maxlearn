# maxlearn

A Claude Code mod: a sidebar study companion that turns your chat and interests into lessons and flashcards, schedules them with spaced repetition, and tracks your progress.

- **Learn** lessons first, then **review** and **quiz** with spaced repetition (SM-2)
- Cards from your chat every few turns, and from interests you add
- Insights: streak, 12-week heat map, weak and strong topics, topics from your daily work
- Keyboard first: `i j k l` move, `enter` selects, `1-4` grade, `h` lists every key

## Run it

```sh
claude --plugin-dir /path/to/maxlearn
```

Then `/study <topic>` to add an interest, and `/study learn` for a lesson in the chat.

## Develop

```sh
claude plugin validate .
claude plugin test .
```
