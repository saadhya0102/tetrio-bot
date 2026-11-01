# TETR.IO Competitive Bot

This is a complete TypeScript baseline for a TETR.IO bot operating with written staff approval:

- Uses Triangle.js (`@haelp/teto`) on Node 22.
- Refuses to run unless both the connected session and authenticated API user have the `bot` role.
- Creates a private room by default and refuses public rooms.
- Validates every live first-ply move against a pinned local Triangle engine model, including SRS kicks, garbage cancellation, line clears, and spin detection.
- Uses a bounded beam search with hold, queue lookahead, danger/downstack modes, and configurable pace.
- Includes offline simulation, benchmarks, deterministic frame-replay/property tests, and JSONL training-data export.

It is intentionally not presented as guaranteed to beat Mochbot. That claim needs repeated, controlled head-to-head matches after the bot account is approved and the room rules are fixed. The project is designed so those benchmarks and later model training can improve it without replacing the network layer.

## Required manual approval

TETR.IO's public API policy does not permit main-game automation without explicit written staff approval. A private/custom room alone is not enough. Before connecting this project, obtain both written approval for this bot's private-room scope and an approved account with role `bot`.

Ask through official Support or the official Discord. A short request can say:

> I am building a TypeScript competitive TETR.IO bot for owner-invited private custom rooms. It refuses non-bot accounts and public rooms, does not enter matchmaking, and identifies itself with a custom user agent. May I have written approval and an official bot identity for this scope?

Once approved, authenticate as that bot account and obtain its own token. Never put a normal-account token in this project or create an alt for testing.

## Start it

1. In the already-created, ignored `.env`, set the approved bot account token and the acknowledgement exactly as shown:

   ```dotenv
   TETRIO_BOT_TOKEN=your-approved-bot-token
   TETRIO_STAFF_APPROVAL=I_HAVE_WRITTEN_TETRIO_STAFF_APPROVAL
   ```

   Leave `TETRIO_ROOM_ID` blank to have the bot create a private room automatically. Public room IDs are rejected.

2. Run:

   ```powershell
   npm run bot
   ```

3. Open the printed room link, ensure bots and hard drop are allowed, and start a round. Use `Ctrl+C` to stop the process cleanly.

## Commands

```powershell
npm test                 # board, search, engine-frame replay, and property tests
npm run test:replay      # focused exact first-ply replay and controller checks
npm run test:property    # randomized, shrinkable local replay checks
npm run check            # TypeScript type check
npm run lint             # static linting
npm run simulate         # offline 250-piece self-play run
npm run simulate -- 500  # choose a simulation length
npm run benchmark        # decision-time benchmark
npm run benchmark:live -- 50  # live-controller replay/selection timing
npm run match -- 200     # paired deterministic local matchup harness
npm run engine:match -- 60  # paired Triangle-engine matchup protocol
npm run engine:tournament -- profiles/default.json 2 60  # engine-backed paired profile screen
npm run tournament -- profiles/default.json 8 120  # compare a profile over paired seeds
npm run tune -- profiles/default.json profiles/tuned.json 2 6 40  # bounded CMA-ES profile search
npm run train:export -- 5000  # JSONL labels for a later training pipeline
npm run bot              # connect the approved bot account
```

## Tuning

The defaults in `.env` (mirrored in `.env.example`) are selected for a stable deterministic baseline:

| Variable                | Meaning                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `TETRIO_STAFF_APPROVAL` | Required acknowledgement after receiving written staff approval. |
| `TETRIO_BOT_PPS`        | Target placement rate. Default: `3.8`.                           |
| `AI_LOOKAHEAD`          | Search depth after the validated live move. Default: `3`.        |
| `AI_BEAM_WIDTH`         | Candidate states retained per search ply. Default: `12`.         |
| `AI_TIME_BUDGET_MS`     | Per-move planning ceiling. Default: `12`, maximum `15`.          |
| `BOT_DEBUG`             | Set to `1` to print each chosen move and planning time.          |

Do not raise all three AI settings at once. The live controller runs in the game tick path, so its time budget is intentionally capped below one 60 Hz frame. First run `npm run benchmark:live`, then increase either lookahead or beam width only if the p95 decision time stays within that cap.

## How it works

1. `src/tetrio/live-enumerator.ts` discovers candidate inputs in a detached Triangle engine, then replays every emitted key plan from the synchronized source snapshot before scoring it. If that fast pool is sparse, the controller has a capped frame-reachability supplement that can add replay-certified paths without replacing the fast fallback. Neither path mutates the live session engine.
2. `src/ai/search.ts` evaluates each legal first move plus a bounded lookahead tree over board, hold, and preview state.
3. `src/ai/evaluator.ts` switches between pressure, downstack, and survival weights using stack height, holes, covered holes, garbage, and field roughness.
4. `src/tetrio/controller.ts` turns the selected move into legal key frames at the configured PPS.
5. `src/simulator/match.ts` runs paired, seeded, two-sided local matches with a trace digest for reproducible offline ablations.
6. `src/simulator/engine-match.ts` runs two isolated pinned Triangle engines with frame barriers and delayed packet delivery for a higher-fidelity offline differential harness.

The live root move is rule-validated by Triangle. The continuation beam is a structural heuristic, so nonstandard board, hold, garbage, combo, bomb, or B2B-charge profiles automatically fall back to a one-ply validated decision instead of using an inaccurate simulated continuation. Exact first-ply garbage facts also prioritize known cancellation and avoid known tanks. This makes it straightforward to replace or blend `HeuristicEvaluator` with a trained value model later while retaining the safety gate, room behavior, engine validation, and test harness.

Triangle is a pinned local behavioral model, not proof of server-level parity. Its lifecycle and garbage paths are incomplete in places, so passing local replay tests establishes a regression contract for the supported profile rather than a universal guarantee. `offline-approx-v1` is a fast BitBoard screening proxy; `triangle-engine-approx-v1` runs a pinned engine per seat, uses shared queue seeds and per-seat garbage streams by default, and still uses an explicitly local cross-seat packet protocol. Validate any target room profile with approved-room differential tests before making strength claims.

## Training later

`npm run train:export` creates labeled JSONL positions under `data/training/`. Each row contains the compact board, current piece, hold, queue, tactical state, and the baseline's chosen placement/value. It is a starting dataset for imitation learning or for bootstrapping self-play.

For a serious strength push, measure a fixed bot-vs-bot suite first, then train a value/policy model against the same room settings. `npm run match` and `npm run tournament` are fast, deterministic BitBoard screening tools. Run finalists through `npm run engine:tournament`, which uses a pinned Triangle engine per seat and paired physical seats. `npm run tune` uses bounded separable CMA-ES over the fast harness and writes a candidate profile after a train/held-out split. Use these tools to reject regressions and compare ablations, then validate finalists in approved rooms. Keep the live first-ply Triangle validation in place so a learned model can recommend moves without sending malformed or illegal input.

## Scope and safety

- The connection library uses TETR.IO's undocumented main-game protocol and may need updates when TETR.IO changes.
- Live startup requires an explicit written-approval acknowledgement, checks `users/me` for the `bot` role, and rejects public rooms.
- Credentials live only in ignored `.env`; do not commit them.
- The bot joins only an approved private, hard-drop-enabled room ID you supply or a private room it created itself.
