# QuantEcon fork of `mystmd` — maintenance guide

This fork exists to carry QuantEcon-specific patches while upstream review is in progress. The goal is to upstream every patch once the `jupyter-book/mystmd` team has capacity to review, then retire those patches from this fork.

## Branching model

| Branch | Purpose |
|---|---|
| `main` | Mirrors `jupyter-book/mystmd:main` exactly. Fast-forward only — **no direct commits**. |
| `feature/<name>` | One branch per logical patch. Branched from `main`, kept rebased on `main`, and used as the source for upstream PRs. |
| `quantecon` | Throwaway integration branch. Rebuilt by `build.sh` as `main` + all active feature branches. **Never commit here directly.** |

## One-time setup

### 1. Add the upstream remote

```bash
git remote add upstream https://github.com/jupyter-book/mystmd.git
```

### 2. Disable release workflows on the fork

The upstream `release.yml` and `publish-github-release.yml` workflows will trigger on pushes to `main`. To prevent accidental npm/PyPI publishes, disable them via the GitHub UI:

> **GitHub → QuantEcon/mystmd → Actions → (select workflow) → Disable workflow**

Do this for `Release` and `Publish GitHub Release`.

## Regular workflow

### Sync `main` with upstream

```bash
git fetch upstream
git checkout main
git merge --ff-only upstream/main
git push origin main
```

Then rebuild the integration branch — see below.

### Add a new feature branch

```bash
git checkout main
git checkout -b feature/<name>
# ... make changes, commit ...
git push origin feature/<name>
```

Add the branch name to `quantecon/features.txt`, then rebuild.

### Rebuild the `quantecon` branch

```bash
./quantecon/build.sh          # dry run (local only)
./quantecon/build.sh --push   # build and push to origin
```

The script:
1. Fast-forwards local `main` from `origin/main`.
2. Resets `quantecon` to `main`.
3. Merges each branch in `features.txt` in order (merge commits, not squash).
4. Patches `packages/mystmd/src/version.ts` to append `-qe` to the version string, so `myst --version` identifies the QuantEcon build.
5. Optionally pushes to `origin/quantecon`.

### Rebase a feature branch after upstream moves

```bash
git checkout feature/<name>
git rebase main
git push --force-with-lease origin feature/<name>
./quantecon/build.sh --push
```

## Resolving merge conflicts

Conflicts are **always fixed on the feature branch**, never on the `quantecon` branch (which is throwaway).

**Feature vs. `main`** (upstream changed code the feature touches):
```bash
git checkout feature/<name>
git rebase main        # resolve conflicts here
git push --force-with-lease origin feature/<name>
./quantecon/build.sh --push
```

**Feature A vs. Feature B** (two patches touch the same lines):
```bash
# Rebase the later branch on top of the earlier one
git checkout feature/<name-b>
git rebase feature/<name-a>
git push --force-with-lease origin feature/<name-b>
# Ensure features.txt lists feature/<name-a> before feature/<name-b>
./quantecon/build.sh --push
```

## When upstream merges a patch

1. Sync `main` with upstream (it now contains the patch).
2. Remove the branch from `features.txt`.
3. Delete the feature branch locally and on origin.
4. Rebuild the `quantecon` branch.

```bash
git fetch upstream
git checkout main && git merge --ff-only upstream/main && git push origin main
# edit features.txt to remove the merged branch
git branch -d feature/<name> && git push origin --delete feature/<name>
./quantecon/build.sh --push
```

## Active patches

See [features.txt](features.txt) for the current list of carry-patches and links to their upstream PRs.
