# QuantEcon fork of `mystmd` — maintenance guide

This fork lets QuantEcon develop and use new `mystmd` features before they have been reviewed and merged by the upstream `jupyter-book/mystmd` team. The goal is to make it as easy as possible to open upstream PRs from feature branches, while also being able to run a combined build that includes all in-progress features.

## How it works — the key idea

```
jupyter-book/mystmd:main
        │  (sync periodically)
        ▼
QuantEcon/mystmd:main          ← pure mirror, never commit here directly
        │
        ├── feature/foo        ← your work; PR open against main (upstream)
        ├── feature/bar        ← another patch; PR open against main (upstream)
        │
        ▼  (built by build.sh)
QuantEcon/mystmd:quantecon     ← combined build: main + all feature branches
```

**Feature branches serve two purposes simultaneously:**

1. They are the source of upstream PRs — targeting `main`, showing only the diff for that one feature. GitHub doesn't know or care that `build.sh` also merges them elsewhere.
2. They are consumed by `build.sh`, which merges all of them onto a throwaway `quantecon` branch that QuantEcon actually builds from.

This means **you never need to choose** between "make it easy to upstream" and "make it available to use now". The feature branch does both. When you update a feature branch (rebase on latest `main`, address reviewer feedback), the upstream PR updates automatically and re-running `build.sh` gives you an updated `quantecon` build.

## Branching model

| Branch | Purpose |
|---|---|
| `main` | Mirrors `jupyter-book/mystmd:main` exactly. Synced via the GitHub "Sync fork" button or `git merge upstream/main`. **No direct commits.** |
| `feature/<name>` | One branch per logical patch. Branched from `main`, kept rebased on `main`. This is the branch you open the upstream PR from. |
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

Either use the **"Sync fork"** button on the GitHub web UI (simplest), or locally:

```bash
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

After syncing, rebuild the `quantecon` branch (see below) so it includes the latest upstream changes.

### Develop a new feature

```bash
git checkout main
git checkout -b feature/<name>
# make your changes and commit them
git push origin feature/<name>
```

Then:
1. Add the branch name to `quantecon/features.txt`
2. Open a PR on GitHub: **base: `jupyter-book/mystmd:main`**, **compare: `QuantEcon/mystmd:feature/<name>`**
3. Rebuild the `quantecon` branch so the feature is available immediately

### Rebuild the `quantecon` branch

```bash
./quantecon/build.sh          # local only (safe, no push)
./quantecon/build.sh --push   # build and push to origin/quantecon
```

The script:
1. Syncs local `main` from `origin/main`
2. Resets `quantecon` to `main` (discarding any previous build)
3. Merges each branch listed in `features.txt` in order (merge commits, not squash)
4. Patches `packages/mystmd/src/version.ts` to append `-qe` to the version (e.g. `1.9.0-qe`), so `myst --version` identifies the QuantEcon build
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

If `main` has moved since you branched:

```bash
git checkout feature/<name>
git rebase main
git push --force-with-lease origin feature/<name>
./quantecon/build.sh --push
```

## Resolving merge conflicts

Conflicts are **always fixed on the feature branch**, never on `quantecon` (which is throwaway and rebuilt from scratch each time).

`build.sh` will abort cleanly and tell you which branch caused the conflict.

**Feature conflicts with `main`** (upstream changed code the feature touches):
```bash
git checkout feature/<name>
git rebase main        # resolve conflicts here, then: git add . && git rebase --continue
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

## Active patches

See [features.txt](features.txt) for the current list of carry-patches and links to their upstream PRs.
