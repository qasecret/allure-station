# Page-specific design overrides

Drop a `<page-name>.md` here to **override** `../MASTER.md` for one screen
(e.g. `dashboard.md`, `project-workspace.md`, `login.md`, `settings.md`).

**Retrieval rule:** when building a page, read `MASTER.md`, then check for
`pages/<page-name>.md`. If it exists, its rules take precedence; otherwise use
`MASTER.md` alone.

Keep overrides minimal — document only the *deviations* from the Master
(a different layout density, an extra chart, a one-off accent usage), not a full
restatement of the system.
