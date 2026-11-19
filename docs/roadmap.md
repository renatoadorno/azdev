# Roadmap

Planned features, in the order they are expected to land. Nothing here is implemented yet.

One rule decides what gets in: azdev only shows what Azure DevOps already knows. A feature that needs someone to type data by hand (time spent, energy, focus) stays out: that data stops being filled in, and the feature goes stale with it.

## Next

### 1. `workitem activity`: what I did, read from revisions

- **Problem:** to say what you did yesterday or this week (standup, weekly report) you rebuild it from memory or keep a log by hand.
- **What:** `azdev workitem activity [--since <when>] [--user <user>]` is a timeline of one person's actions: cards created, state changes, reassignments, comments, sprint and parent moves. `--since` takes the forms of `workitem inbox` (`today`, `yesterday`, `7d`, `YYYY-MM-DD`), default `today`. `--user` defaults to `@me`.
- **How:**
  - Candidates come from `[System.ChangedBy] EVER @me AND [System.ChangedDate] >= <since>`. It also returns the cards the user created, because revision 1 is the creator's.
  - The last changer is not enough. On a real board, the user was not the last to touch more than half of the cards they changed in a week. So each candidate's revisions are read back to `since`, as `workitem inbox` does (`revisionsSince` in `src/services/InboxService.ts`, to be shared by both), and only the user's revisions are kept.
  - Rows come from `revisionTimeline` (`src/services/history.ts`). Filtering and grouping go in a new pure module, `src/services/activity.ts`.
- **Open:** day boundaries in local time or UTC; whether grouping by story is needed or `sprint summary` covers it.

### 2. `sprint scope`: what entered and left a sprint, by story

- **Problem:** `sprint progress --daily` shows the item count growing, but not why. On a real board the count tripled within four days of the sprint start. Almost all of that came from cards created under stories already planned, so counting cards labels normal work as unplanned.
- **What:** `azdev sprint scope [sprint] [--baseline <when>] [--mine]` compares the sprint at a baseline with now, or with its end once it is over. It lists the stories that entered after the baseline, the stories that left, and the items of `operationalTypes` (flows.json) created during the sprint, which are the unplanned work. A new card under a story that was already in the sprint is not new scope.
- **How:** WIQL `ASOF`, as `sprint carryover` already does (`src/services/StatsService.ts`). Each card's story comes from `System.Parent`. The classification is a pure function next to `src/services/stats.ts`.
- **Open:**
  - The default baseline. The end of the first day is the candidate, because planning spills over day one.
  - Counts only, no hours. Remaining and original work are rarely filled: on the same board, no closed item had Completed Work, and under 1% had Original Estimate.

## Later

### 3. Skill recipes for standup, weekly report and retrospective

No new command. These are sections in `plugin/skills/azdev-cli` that combine existing commands:

- **Standup:** `workitem activity --since yesterday`, `workitem mine --open`, `stats aging --inProgress --mine`.
- **Weekly report:** `workitem activity --since 7d`, `sprint summary`.
- **Retrospective:** `sprint summary`, `sprint progress --daily`, `sprint carryover`, `sprint scope`, `stats cycle-time`.

This lands after 1 and 2. `test/plugin.test.ts` fails when a skill mentions a subcommand that does not exist.

### 4. `workitem link --url`

- **Problem:** `workitem link` only links work items, so a pull request or a document ends up as a URL inside a description.
- **What:** `azdev workitem link <id> --url <url> [--comment <t>]` adds a `Hyperlink` relation.
- **Open:** whether an `ArtifactLink` to a pull request is worth it. It needs the repository connected to the project, while a `Hyperlink` works for any URL. Finding which pull request belongs to which card stays outside azdev.

## Maybe

### 5. Flow for a card inside a shared parent

- **Problem:** hot fixes often live under one long-lived support story, and each hot fix has its own publication cards as siblings. `flow apply` matches cards among the parent's children, so the second hot fix finds the first one's `[PROD]` card and reports it as `exists`.
- **Idea:** a flow whose target is the card itself. Its cards are created under the target's parent and linked to the target with `Related`, and `flow status` finds them through that link instead of the title.
- **Open:** whether it pays off. Decide that before designing it.

### 6. Perennial cards in flows.json

- **Problem:** catch-all cards ("log your dailies here") stay open forever and move from sprint to sprint, so they show up in team-wide `sprint carryover` and `stats aging`.
- **Idea:** a list of ids to ignore in flows.json, like `backlogSprints`. It only matters for queries without `--mine`.

## Not planned

These ideas were considered and left out. They are listed so they are not proposed again:

- **Estimated vs actual time:** it needs Original Estimate and Completed Work, which the board this was checked against does not fill.
- **Energy, focus, deep-work hours, context switches, time blocking:** typed by hand, with no source in Azure DevOps.
- **Creating a daily-meeting card every day:** it is one `workitem create`; scheduling it belongs to cron or the agent.
- **Branch names and commit messages carrying the card id, matching pull requests to cards:** this is repository tooling, outside azdev.
- **Inferring type and tags from a description:** the agent's job, with `metadata types`, `metadata tags` and the user's `conventions.md`.
- **Notifications (Slack, Teams), scheduled syncs, HTML dashboards:** `azdev serve` already feeds live clients.
