# QuantEcon fork of `mystmd` — maintenance guide

This fork lets QuantEcon develop and use new `mystmd` features before they have been reviewed and merged by the upstream `jupyter-book/mystmd` team. The goal is to make it as easy as possible to open upstream PRs from feature branches, while also being able to run a combined build that includes all in-progress features.

## How it works — the key idea

```
jupyter-book/mystmd:main  ─────┐
        │  (sync periodically) │  (feature branches start here)
        ▼                      │
QuantEcon/mystmd:main          │  ← mirror + quantecon/ tooling
        │                      │
        │   feature/foo  ◄─────┤  ← branched from upstream/main; PR target = upstream main
        │   feature/bar  ◄─────┘  ← branched from upstream/main; PR target = upstream main
        ▼  (built by build.sh, which merges feature branches into quantecon)
QuantEcon/mystmd:quantecon     ← combined build: main + all feature branches
```

**Feature branches serve two purposes simultaneously:**

1. They are the source of upstream PRs — targeting `jupyter-book/mystmd:main`, showing only the diff for that one feature. They are branched from `upstream/main` so they don't carry the `quantecon/` folder.
2. They are consumed by `build.sh`, which merges them onto the throwaway `quantecon` branch (which inherits the `quantecon/` folder from `main`).

This means **you never need to choose** between "make it easy to upstream" and "make it available to use now". The feature branch does both.

## Branching model

| Branch | Purpose |
|---|---|
| `main` | `upstream/main` **plus** the `quantecon/` tooling folder (this directory). Synced via `git merge upstream/main` — see note below. **The only commits permitted on `main` are changes to `quantecon/`.** |
| `feature/<name>` | One branch per logical patch. **Branched from `upstream/main`** (not `main`), kept rebased on `upstream/main`. This is the branch you open the upstream PR from. |
| `quantecon` | Throwaway combined build. Rebuilt by `build.sh` as `main` + all active feature branches. **Never commit here directly — it is always discarded and regenerated.** |

## One-time setup

```bash
git remote add upstream https://github.com/jupyter-book/mystmd.git
```

Verify your remotes look like this:

```
origin    https://github.com/QuantEcon/mystmd.git  (fetch/push)
upstream  https://github.com/jupyter-book/mystmd.git  (fetch/push)
```

## Regular workflow

### Sync `main` with upstream

Because `main` carries the `quantecon/` tooling, it is permanently a few commits ahead of `upstream/main`. Syncing is therefore a **merge**, not a fast-forward:

```bash
git fetch upstream
git checkout main
git merge upstream/main      # produces a merge commit
git push origin main
```

> **Do not use the GitHub "Sync fork" button.** It expects a fast-forward and, when it can't, will offer to *discard* the diverging commits — which would delete this `quantecon/` folder. Always sync from the command line.

> **If `main` is branch-protected and the sync has to go through a PR**, when merging that PR on GitHub choose **"Create a merge commit"** — *never* "Squash and merge". Squash-merge rewrites the upstream commit to a new SHA, so it stops being an ancestor of `main`. GitHub's "X commits behind" counter then stays stuck reporting the upstream commit as missing (the *content* is there, but the *ancestry* isn't), and every subsequent `git merge upstream/main` produces a noisy near-empty merge commit. A real merge commit preserves the ancestry.

After syncing, rebuild the `quantecon` branch (see below) so it includes the latest upstream changes.

### Develop a new feature

> **Important:** branch from `upstream/main`, **not** from `main`. This keeps the `quantecon/` folder out of your feature branch, so the upstream PR diff shows only your actual changes.

```bash
git fetch upstream
git checkout -b feature/<name> upstream/main
# make your changes and commit them
git push origin feature/<name>
```

Then:
1. Add the branch name to `quantecon/features.txt` (on `main`, then commit and push)
2. Open a PR on GitHub: **base: `jupyter-book/mystmd:main`**, **compare: `QuantEcon/mystmd:feature/<name>`**
3. Rebuild the `quantecon` branch so the feature is available immediately

> **Why this works:** `build.sh` runs from `main` (which has the `quantecon/` folder), checks out the `quantecon` branch, and merges your feature branch into it. Because git merges *changes* (not full trees), the feature branch doesn't need to contain `quantecon/` — the folder comes from `main`, and your feature's changes are layered on top.

### Migrating an existing feature branch to use upstream/main as base

If you already have a feature branch that was created from `main` (and therefore includes the `quantecon/` folder commits), rebase it onto `upstream/main`:

```bash
git fetch upstream
git checkout feature/<name>
git rebase --onto upstream/main main
git push --force-with-lease origin feature/<name>
```

This replays only your feature's commits on top of `upstream/main`, dropping the `quantecon/` folder commits from the branch's history. The upstream PR diff will then show only your actual changes.

### Rebuild the `quantecon` branch

```bash
./quantecon/build.sh          # local only (safe, no push)
./quantecon/build.sh --push   # build and push to origin/quantecon
```

The script:
1. Syncs local `main` from `origin/main`
2. Resets `quantecon` to `main` (discarding any previous build)
3. Merges each branch listed in `features.txt` in order (merge commits, not squash)
4. Patches `packages/mystmd/package.json` version to append `-qe` (e.g. `1.9.0-qe`). The `copy:version` build step propagates this to `version.ts` at build time, so `myst --version` identifies the QuantEcon build.
5. Optionally pushes to `origin/quantecon`

Run this after every upstream sync, after updating any feature branch, or after adding/removing a feature branch from `features.txt`.

### Update a feature branch (e.g. to address upstream reviewer feedback)

```bash
git checkout feature/<name>
# make changes, amend or add commits
git push --force-with-lease origin feature/<name>
# the upstream PR updates automatically
./quantecon/build.sh --push   # rebuild quantecon with the updated branch
```

### Keep a feature branch current with upstream

If `upstream/main` has moved since you branched:

```bash
git fetch upstream
git checkout feature/<name>
git rebase upstream/main
git push --force-with-lease origin feature/<name>
./quantecon/build.sh --push
```

## Resolving merge conflicts

Conflicts are **always fixed on the feature branch**, never on `quantecon` (which is throwaway and rebuilt from scratch each time).

`build.sh` will abort cleanly and tell you which branch caused the conflict.

**Feature conflicts with upstream** (upstream changed code the feature touches):
```bash
git fetch upstream
git checkout feature/<name>
git rebase upstream/main   # resolve conflicts here, then: git add . && git rebase --continue
git push --force-with-lease origin feature/<name>
./quantecon/build.sh --push
```

**Feature A conflicts with feature B** (two patches touch the same lines):
```bash
# Rebase the later branch on top of the earlier one to establish ordering
git checkout feature/<name-b>
git rebase feature/<name-a>
git push --force-with-lease origin feature/<name-b>
# Make sure features.txt lists feature/<name-a> before feature/<name-b>
./quantecon/build.sh --push
```

## When upstream merges a feature

Once the upstream PR is merged into `jupyter-book/mystmd:main`:

1. Sync `main` with upstream — it now contains the feature
2. Remove the branch from `features.txt`
3. Delete the feature branch
4. Rebuild `quantecon` — the feature is now in `main` itself, so nothing is lost

```bash
git fetch upstream
git checkout main && git merge upstream/main && git push origin main
# edit features.txt to remove the branch
git branch -d feature/<name> && git push origin --delete feature/<name>
./quantecon/build.sh --push
```

## Installing the QuantEcon build in GitHub Actions

The `quantecon` branch is a standard monorepo — it must be cloned, built from source, and the `mystmd` package installed globally. There is no published npm package.

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '20'

- uses: oven-sh/setup-bun@v2

- name: Install mystmd (QuantEcon fork)
  run: |
    git clone --branch quantecon --depth 1 \
      https://github.com/QuantEcon/mystmd.git /tmp/qe-mystmd
    cd /tmp/qe-mystmd
    bun install
    bun run build
    npm install -g /tmp/qe-mystmd/packages/mystmd

- name: Verify
  run: myst --version
  # should print e.g. 1.9.0-qe
```

This installs the `myst` CLI globally. The `-qe` version suffix confirms you are running the QuantEcon build.

## Active patches

See [features.txt](features.txt) for the current list of carry-patches and links to their upstream PRs.
