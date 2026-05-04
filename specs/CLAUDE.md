# specs/ — Interaction Specs workflow (for agents)

Platform-neutral UX rules. Each rule has a stable ID like
`sheet.clipboard.copy` and lives in its own `.md`. See `README.md`
for the file format + category list; this doc is the **agent
workflow** for adding, updating, and tagging.

## Rule of thumb

If you touched user-visible behavior — anything a user can see, do,
or keystroke their way through — update `specs/` in the same commit
as the code. CSS-only visual tweaks (spacing, colour, density)
usually don't need a spec unless they encode a behavior (e.g. "this
tint appears when X").

## Adding a new behavior

1. Pick an ID: `sheet.<category>.<kebab-slug>`. Categories listed
   in `../README.md`. Reuse existing categories before inventing
   new ones.
2. Create `specs/<id>.md` with the YAML frontmatter + the five
   required sections (Trigger / Effect / Edge cases / Visual
   feedback / Rationale). Optional `## Notes` for per-platform
   quirks. Keep each spec under ~1 page rendered.
3. Tag the implementation site with a one-line comment:
   ```js
   // [sheet.category.slug]
   function handleIt() { ... }
   ```
   One tag per implementation block. If the behavior spans multiple
   call sites, tag each one.
4. Add the one-liner to `INDEX.md` under the right category.

## Changing an existing behavior

1. Find the current spec (`grep -R 'sheet.<slug>' specs/` or browse
   `INDEX.md`).
2. Update the **Effect** / **Edge cases** / **Rationale** sections.
   Don't rewrite the Trigger unless the keystroke or input
   literally changed.
3. If the old rule is user-facing enough that someone might paste
   an old ID into a bug report, leave the ID stable. Only rename
   the file / ID if the behavior is genuinely a different thing.
4. When in doubt, add a `## Notes — history:` block explaining
   what changed and why, so future readers understand the drift.

## Renaming or deprecating

- Mark the old spec `status: deprecated` in its frontmatter, leave
  it in place, and add a `related:` pointer to its replacement.
- Drop the `// [id]` tags from code in the same commit, then add
  tags for the new spec.

## Cross-check before committing

From the repo root:

```bash
grep -R '\[sheet\.' frontend/src/ \
  | grep -oE '\[sheet\.[a-z0-9.-]+\]' \
  | sort -u > /tmp/tags.txt

ls specs/sheet.*.md \
  | sed 's|specs/||; s|\.md$||' \
  | sed 's/^/[/; s/$/]/' \
  | sort -u > /tmp/specs.txt

comm -23 /tmp/tags.txt /tmp/specs.txt   # tags pointing at nothing
```

Should print no lines. Untagged specs (the reverse diff) are
allowed — they're the *CSS-only* ones, correctly flagged in
`INDEX.md`.

## Scope discipline

- Keep spec bodies platform-neutral. No DOM / Svelte store /
  NSView / termios talk in the five required sections. Save it for
  `## Notes` clearly labelled per platform.
- If a spec is growing past ~1 page, split it. "Select with Shift"
  and "Extend with Shift+Arrow" are separate behaviors — not one
  mega-spec.
- Don't tag every line that *touches* selection state — only the
  block(s) that implement the specific rule the ID describes.
