# QuantEcon fork of `mystmd` — maintenance guide

This fork lets QuantEcon develop and use new `mystmd` features before they land in `jupyter-book/mystmd`. Features are developed on short-lived feature branches off this fork's `main`, squash-merged in, and the feature branch is deleted. Upstream PRs are prepared later by **cherry-picking** one or more squash commits from `main` onto a fresh branch off `upstream/main` — bundling related features into a cohesive upstream story when that makes sense.

> **About this folder.** `quantecon/` doubles as a local scratch space for planning docs, demo books, and experiments. By default everything is gitignored; only the files in [`.gitignore`](.gitignore)'s allow-list are tracked — currently [`README.md`](README.md), [`VERSION.yml`](VERSION.yml), [`UPSTREAM-PRS.yml`](UPSTREAM-PRS.yml), and [`.gitignore`](.gitignore) itself. Feel free to drop PLAN docs, demo `myst.yml` projects, etc. here without worrying about accidental commits. To track something new intentionally, add it to the allow-list.

## The two tracker files

Two tracked YAML files in `quantecon/` record orthogonal facts. Keep them in sync — cross-reference is by squash-commit SHA.

| File | Question it answers |
|---|---|
| [`VERSION.yml`](VERSION.yml) | *What QuantEcon squash commits are in our `main` right now?* Diagnostic / traceability — lecture builds cat this to log the fork state they're using. |
| [`UPSTREAM-PRS.yml`](UPSTREAM-PRS.yml) | *How do we plan to ship those squash commits upstream?* Bundles related squashes into logical upstream PR candidates, records dependency order for cherry-pick, tracks upstream PR / merge status. |

### Maintaining `VERSION.yml`

Every time a feature PR lands on `main`, append a row to `merged_features` with its squash `merge_sha`. The `tag` field stays null until the next `qe-v<N>` checkpoint.

Tags are cut at meaningful checkpoints, **not per-PR** — typically when a batch of features is ready for downstream dogfooding. To cut a tag:

1. Pick the `main` commit at the head of the batch
2. Tag it: `git tag qe-v<N+1> <sha> -m "qe-v<N+1>: <summary of features included>"` then `git push origin qe-v<N+1>`
3. Set `tag: qe-v<N+1>` on each newly-included feature in `merged_features` and bump `qe_version`

### Maintaining `UPSTREAM-PRS.yml`

Update this whenever a feature lands on `main` or its upstream plan changes:

- New feature with no obvious bundle → add as a standalone candidate (`status: pending`, `commits: [<sha>]`).
- Feature extends an existing candidate → append its sha to that candidate's `commits` list (e.g. a follow-up Copilot-fix PR that lands on `main` after the original feature).
- Feature deserves its own upstream story but depends on another → new candidate with `depends_on: [<other-candidate-id>]`.

Status transitions: `planned` → `pending` (all commits landed) → `open` (upstream PR exists) → `merged` (upstream merged it). On `merged`, also run the post-merge sync workflow below.

## How it works — the key idea

```
jupyter-book/mystmd:main  ───── (sync periodically via merge)
        │
        ▼
QuantEcon/mystmd:main  ◄──────────────────────────────────────┐
        │                                                      │
        │   feature/<name>  (branched from origin/main)        │
        │        │                                              │
        │        │   PR against QuantEcon/mystmd:main           │
        │        ├──── squash-merge ──────────────────────────► │
        │        │                                              │
        │        ▼   (branch deleted after merge)
        │   (gone — the main-line squash commit is the artifact)
        │
        │   …later, when ready to upstream:
        │
        │   upstream/<topic>  (fresh branch off upstream/main)
        │        │   cherry-pick <squash-sha> [<squash-sha> …]
        │        │
        │        │   PR against jupyter-book/mystmd:main
        │        ▼
        │   upstream review & merge
```

**Why this works:**

1. **Local integration.** Each feature is squash-merged into `main` once it's ready, so projects can install from `main` and immediately use the feature. Feature branches are throwaway scaffolding; the squash commit is the canonical artifact.
2. **Upstream PR composition.** When upstream is ready, we cherry-pick one or more squash commits onto a fresh branch from `upstream/main` and open the PR. The cherry-pick lets us bundle related features ("book mode + section scope") as a cohesive upstream story, or split them apart, depending on what the upstream maintainers want to review.
3. **No long-lived branches.** Feature dependencies (PR #28 building on PR #22) just work — branch off `main`, get the prior features for free. No parallel rebases against `upstream/main`.

## Branching model

| Branch | Purpose |
|---|---|
| `main` | `upstream/main` **plus** all squash-merged QuantEcon features. Synced from upstream periodically via merge (see below). Projects install from here. |
| `feature/<name>` | One short-lived branch per logical patch. **Branched from `origin/main`** (the fork's `main`). Opened as a PR against `QuantEcon/mystmd:main`, squash-merged, then deleted. |
| `upstream/<topic>` | Short-lived branch prepared at upstream-PR time. **Branched from `upstream/main`**. One or more squash commits from `main` are cherry-picked onto it, then it's opened as a PR against `jupyter-book/mystmd:main`. Deleted once that PR resolves. |

## One-time setup

```bash
git remote add upstream https://github.com/jupyter-book/mystmd.git
```

Verify your remotes:

```
origin    https://github.com/QuantEcon/mystmd.git
upstream  https://github.com/jupyter-book/mystmd.git
```

## Regular workflow

### Develop a new feature

```bash
git fetch origin
git checkout -b feature/<name> origin/main
# make your changes, commit
git push -u origin feature/<name>
```

Open a PR on GitHub: **base: `QuantEcon/mystmd:main`**, **compare: `QuantEcon/mystmd:feature/<name>`**.

Review locally, address feedback, then **squash-merge** through the GitHub UI. Delete the branch after merging — the squash commit on `main` is the canonical artifact, and the branch is no longer needed. (GitHub offers a "Delete branch" button right after the merge.)

### Sync `main` with upstream

`main` carries squash commits that aren't in `upstream/main`, so syncing is a **merge**, not a fast-forward:

```bash
git fetch upstream
git checkout main
git merge upstream/main      # produces a merge commit
git push origin main
```

> **Do not use the GitHub "Sync fork" button.** It expects a fast-forward and will offer to *discard* the diverging commits — which would delete the features you've merged in. Always sync from the command line.

> **If `main` is branch-protected and the sync has to go through a PR**, choose **"Create a merge commit"** when merging — *never* "Squash and merge". A real merge commit preserves the ancestry so `git merge upstream/main` works cleanly next time.

### Keep a feature branch current with `main`

If `main` moves while a feature PR is in review (e.g. another feature lands first), rebase onto the new `main`:

```bash
git fetch origin
git checkout feature/<name>
git rebase origin/main
# resolve any conflicts
git push --force-with-lease origin feature/<name>
```

This is the only rebase you need during normal development — the cherry-pick model means we never rebase a feature branch onto `upstream/main` itself.

## Opening an upstream PR

When the upstream team is ready to review one or more of our features:

1. Look up the candidate in [`UPSTREAM-PRS.yml`](UPSTREAM-PRS.yml) — its `commits` block lists the squash SHAs to cherry-pick, in dependency order. (If no candidate exists yet for what you're shipping, add or adjust one first.)
2. Create a fresh branch off `upstream/main`:
   ```bash
   git fetch upstream
   git checkout -b upstream/<topic> upstream/main
   ```
3. Cherry-pick the squash commits in dependency order:
   ```bash
   git cherry-pick <sha-1> [<sha-2> …]
   # resolve conflicts if upstream has drifted
   ```
4. Push and open the upstream PR:
   ```bash
   git push -u origin upstream/<topic>
   ```
   Open a PR on GitHub: **base: `jupyter-book/mystmd:main`**, **compare: `QuantEcon/mystmd:upstream/<topic>`**.

**Bundling vs. splitting.** Whether to cherry-pick one squash commit or several into the same upstream PR is a per-attempt judgment call:

- *Bundle* when the features form one coherent story upstream maintainers will review together (e.g. "book mode + section-scoped numbering" — the second extends the first; reviewing them apart wastes everyone's time).
- *Split* when the features are independent. Two upstream PRs, two cherry-pick branches.

If the cherry-picked commits should appear as one upstream commit (cleaner review), `git rebase -i upstream/main` to fixup before pushing.

### When upstream merges the feature

Once the upstream PR is merged into `jupyter-book/mystmd:main`:

1. **Sync our `main` with upstream** (instructions above) — upstream's version of the change now lands in our `main`.
2. **Update [`UPSTREAM-PRS.yml`](UPSTREAM-PRS.yml)** — set the candidate's `status: merged` and fill in `upstream.pr` and `upstream.merged_sha`.
3. **Delete the `upstream/<topic>` branch** if it's still around.

The original squash commit on our `main` is now redundant with the upstream merge. Git's merge machinery handles this correctly (the changes are already in the tree), so no manual cleanup is needed in source files.

## Resolving merge conflicts between features

If two feature branches touch the same lines, squash-merge them in dependency order. After the first one lands on `main`, rebase the second onto the new `main`:

```bash
git checkout feature/<later>
git rebase origin/main
# resolve conflicts, git add, git rebase --continue
git push --force-with-lease origin feature/<later>
```

Then continue with the normal PR review and squash-merge. When eventually upstreaming, the cherry-pick order on the `upstream/<topic>` branch is the same dependency order.

## Installing the QuantEcon build in GitHub Actions

This is a standard monorepo — clone, build, install globally. There is no published npm package.

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '20'

- uses: oven-sh/setup-bun@v2

- name: Install mystmd (QuantEcon fork)
  run: |
    git clone --branch main --depth 1 \
      https://github.com/QuantEcon/mystmd.git /tmp/qe-mystmd
    cd /tmp/qe-mystmd
    bun install
    bun run build
    npm install -g /tmp/qe-mystmd/packages/mystmd
```

Pin to a specific tag if you need reproducibility:

```bash
git clone https://github.com/QuantEcon/mystmd.git /tmp/qe-mystmd
cd /tmp/qe-mystmd
git checkout qe-v<N>           # or a specific commit sha
bun install && bun run build
npm install -g /tmp/qe-mystmd/packages/mystmd
```

## In-flight feature branches

Feature branches are short-lived: open, review, squash-merge, delete. If any remain on `origin`:

```bash
git branch -r | grep '^  origin/feature/'
```

…they're either work in progress or stale leftovers that can be deleted. Check the corresponding PR state before deleting.
