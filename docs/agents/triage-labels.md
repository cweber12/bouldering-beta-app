# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `in-progress`              | `in-progress`        | An agent has started; a branch exists    |
| `done`                     | `done`               | Implemented, verified, and merged        |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

The first five roles are the **triage** vocabulary (states an issue can be in before implementation starts). `in-progress` and `done` are the two **lifecycle** states that carry an issue through implementation to a merged, closed outcome. Together with `wontfix`, `done` is a terminal state: every issue must end at `done` or `wontfix`, never lingering at `ready-for-agent` after its code has shipped.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table. Since issues are tracked as local markdown, apply the label by writing it into the issue file's `Status:` line rather than calling an external tracker. The full state transitions (`ready-*` → `in-progress` → `done`) are described in `issue-tracker.md`.

Edit the right-hand column to match whatever vocabulary you actually use.
