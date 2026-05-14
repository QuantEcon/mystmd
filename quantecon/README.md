# QuantEcon fork of `mystmd` — maintenance guide

This fork lets QuantEcon develop and use new `mystmd` features before they land in `jupyter-book/mystmd`. Features are developed on feature branches, squash-merged into this fork's `main`, and the same feature branches are kept alive so they can be opened as upstream PRs whenever the upstream team is ready to review them.

> **About this folder.** `quantecon/` doubles as a local scratch space for planning docs, demo books, and experiments. Everything except this `README.md` is gitignored — feel free to drop PLAN docs, demo `myst.yml` projects, etc. here without worrying about accidental commits. To track something new intentionally, add it to the allow-list in [.gitignore](.gitignore).

## How it works — the key idea

```
jupyter-book/mystmd:main  ───── (sync periodically via merge)
        │
        ▼
QuantEcon/mystmd:main  ◄────────────────────────────────────┐
        │                                                    │
        │   feature/<name>  (branched from upstream/main)    │
        │        │                                            │
        │        │   PR against QuantEcon/mystmd:main         │
        │        ├──── squash-merge ────────────────────────► │
        │        │                                            │
        │        │   (branch kept alive after merge,
        │        │    used later for upstream PR against
        │        ▼    jupyter-book/mystmd:main)
        │   feature/<name> (preserved)
```

**Feature branches serve two purposes:**

1. **Local integration.** Each branch is squash-merged into `main` once it's ready, so projects can install from `main` and immediately use the feature.
2. **Upstream PR artifact.** The branch is *not deleted* after squash-merge. When upstream is ready to review, the original branch (with its granular commit history) is pushed and opened as a PR against `jupyter-book/mystmd:main`.

This means you get a clean integration `main` for day-to-day use *and* preserved per-commit history for upstream review — without maintaining a separate integration branch.

## Branching model

| Branch | Purpose |
|---|---|
| `main` | `upstream/main` **plus** all squash-merged features. Synced from upstream periodically via merge (see below). Projects install from here. |
| `feature/<name>` | One branch per logical patch. **Branched from `upstream/main`** (not `main`), kept rebased on `upstream/main`. Opened as a PR against `QuantEcon/mystmd:main` for local merge, then preserved for the eventual upstream PR. |

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

> **Important:** branch from `upstream/main`, **not** from `main`. The feature branch must stay rebaseable onto `upstream/main` so it remains a clean upstream PR candidate.

```bash
git fetch upstream
git checkout -b feature/<name> upstream/main
# make your changes, commit
git push origin feature/<name>
```

Open a PR on GitHub: **base: `QuantEcon/mystmd:main`**, **compare: `QuantEcon/mystmd:feature/<name>`**.

Review locally, address feedback, then **squash-merge** through the GitHub UI. Do **not** delete the branch after merging — it is the upstream PR artifact.

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

### Keep a feature branch current with upstream

If `upstream/main` moves and you need to refresh a still-open feature branch (e.g., to address feedback or prepare for upstreaming):

```bash
git fetch upstream
git checkout feature/<name>
git rebase upstream/main
git push --force-with-lease origin feature/<name>
```

If that feature has already been squash-merged into our `main`, the rebased branch simply replays the same commits onto a newer base — upstream PR readiness is preserved.

## Opening the upstream PR

When the upstream team is ready to review a feature:

1. Make sure the feature branch is rebased onto current `upstream/main` (see above).
2. Push the branch (likely already pushed).
3. Open a PR on GitHub: **base: `jupyter-book/mystmd:main`**, **compare: `QuantEcon/mystmd:feature/<name>`**.

The PR shows the granular per-commit history, which reviewers prefer. The squash commit on QuantEcon's `main` is *not* what upstream sees — that's a local-integration artifact.

### When upstream merges the feature

Once the upstream PR is merged into `jupyter-book/mystmd:main`:

1. Sync our `main` with upstream (instructions above) — upstream's version now lands.
2. Delete the local feature branch:
   ```bash
   git branch -d feature/<name>
   git push origin --delete feature/<name>
   ```

The squash commit that lived on our `main` is now redundant with the upstream merge. Git's merge machinery handles this correctly (the changes are already in the tree), so no manual cleanup is needed.

## Resolving merge conflicts between features

If two feature branches touch the same lines, squash-merge them in dependency order. After the first one lands on `main`, rebase the second onto the new `main`:

```bash
git checkout feature/<later>
git rebase main
# resolve conflicts, git add, git rebase --continue
git push --force-with-lease origin feature/<later>
```

Then continue with the normal PR review and squash-merge.

> The rebased `feature/<later>` is still upstream-PR-ready — when the time comes to upstream it, rebase it back onto `upstream/main` (which will pull in `feature/<earlier>` if that has already been upstreamed, or stage the upstream PR after `feature/<earlier>`'s).

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

- name: Verify
  run: myst --version
```

Pin to a specific commit if you need reproducibility:

```bash
git clone https://github.com/QuantEcon/mystmd.git /tmp/qe-mystmd
cd /tmp/qe-mystmd
git checkout <commit-sha>
bun install && bun run build
npm install -g /tmp/qe-mystmd/packages/mystmd
```

## Active feature branches

```bash
git branch -r | grep '^  origin/feature/'
```

Each is squash-merged into `main` once ready, and preserved for eventual upstream PR.
