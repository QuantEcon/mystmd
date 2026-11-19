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

Every time a feature PR lands on `main`, append a row to `merged_features` with its squash `merge_sha`. The `tag` field stays null until a `qe-v<N>` tag is cut over that feature.

`upstream_base` is the latest upstream mystmd release that `main` contains, and `upstream_commit` is the exact `upstream/main` commit that `main` was last synced to. The fork syncs to upstream's `main`, not to its releases, so `upstream_commit` is usually ahead of `upstream_base`. For example, qe-v10 and qe-v11 are both on 1.10.1, but they contain different upstream code, and only `upstream_commit` shows the difference. Both fields are refreshed when a tag is cut, not in sync PRs, which merge as-is.

Tags can be cut per-PR (one tag per feature, easy traceability) or batched at a checkpoint (one tag covering several merged features ready to deploy to book-dp1 / book-dp2 for testing) — pick whichever fits the cadence. To cut a tag, do the metadata update *first* so the tagged commit's tree is self-consistent:

1. Open a doc PR updating `VERSION.yml`: bump `qe_version` to `qe-v<N+1>`, refresh `upstream_base` / `upstream_commit`, and set `tag: qe-v<N+1>` on each previously-untagged entry in `merged_features` that is included in this tag. For the upstream fields, after `git fetch upstream --tags`, run `git describe --tags --match 'mystmd@*' "$(git merge-base origin/main upstream/main)"`. Output like `mystmd@1.10.1-43-gd09d3e59` means 43 upstream commits past 1.10.1, so `upstream_base: 1.10.1` and `upstream_commit: d09d3e59`.
2. Squash-merge the doc PR.
3. Tag the resulting `main` commit: `git tag qe-v<N+1> <sha> -m "qe-v<N+1>: <summary>"` then `git push origin qe-v<N+1>`.
4. Before moving any book's pin to the new tag, run the release test in [QuantEcon/test-quantecon-mystmd](https://github.com/QuantEcon/test-quantecon-mystmd) (private): `gh workflow run release-test.yml --repo QuantEcon/test-quantecon-mystmd -f candidate=qe-v<N+1>`. It builds each consumer book with the tag it deploys today and with the new tag, then reports whether anything readers see would change: build warnings, content, rendered pages, numbering and cross-references. The report is on the run's summary page.
5. Once the report shows no unexpected change, move each book's pin to the new tag with a pull request in that book's repository.

Doing steps 1–3 in this order means anyone who `cat`s `VERSION.yml` at tag `qe-v<N+1>` sees a self-consistent file (qe_version field matches the tag).

### Maintaining `UPSTREAM-PRS.yml`

This file holds **only implemented work**: squash commits on `main` that we plan to upstream. Anything not yet implemented, whether a planned feature or a diagnosed defect, is a fork issue until its commit lands, and an issue about a defect in upstream's own code carries the [`upstream`](https://github.com/QuantEcon/mystmd/labels/upstream) label. Fork-only changes, such as `cli-show-qe-version`, get a `VERSION.yml` row but no entry here. A fix goes upstream only after it lands on `main` and has an entry here.

Update this whenever a feature **or an upstream bug fix** lands on `main`, or its upstream plan changes:

- New feature with no obvious bundle → add as a standalone candidate (`status: pending`, `commits: [<sha>]`).
- Feature extends an existing candidate → append its sha to that candidate's `commits` list (e.g. a follow-up Copilot-fix PR that lands on `main` after the original feature).
- Feature deserves its own upstream story but depends on another → new candidate with `depends_on: [<other-candidate-id>]`.
- Fix for a defect in upstream's own code lands → add as a candidate with `type: bug-fix`, naming in `notes` the fork issue it settles. **The defect on its own does not get an entry** — it stays a fork issue until a fix exists, because this file plans how landed commits reach upstream and a defect with no commits has nothing to plan.

Status transitions: `pending` (all commits landed) → `open` (upstream PR exists) → `merged` (upstream merged it). On `merged`, also run the post-merge sync workflow below.

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

`main` carries squash commits that aren't in `upstream/main`, so syncing is a **merge**, not a fast-forward. `main` is protected: a change needs a PR whose branch is up to date with `main` and passes its required checks: lint, the docs build, and the test jobs on Node 22 and 24 (Node 26 also runs, but isn't required). So the merge goes through a PR:

```bash
git fetch upstream
git fetch origin
git checkout -b sync/upstream-YYYY-MM-DD origin/main
git merge upstream/main      # produces a merge commit; resolve conflicts here
git push origin sync/upstream-YYYY-MM-DD
```

Open the PR against `main`, and start its description with this callout:

```markdown
> [!IMPORTANT]
> **Merge with "Create a merge commit", never "Squash and merge".** A real merge commit keeps the ancestry so the next `git merge upstream/main` stays clean.
```

The `main` ruleset allows both squash and merge commits, and GitHub can't set the method for one PR, so the callout is what protects the ancestry. A squash-merged sync would leave `main` without upstream's history, so the next sync would merge those upstream commits again as if they were new, with conflicts it shouldn't have.

> **Do not use the GitHub "Sync fork" button.** It expects a fast-forward and will offer to *discard* the diverging commits — which would delete the features you've merged in. Always sync from the command line.

#### Sync checklist

- **Conflicts:** resolve them in the merge commit and list each resolution in its message. Keep fork-side follow-ups, such as moving a fork-only package to new upstream tooling, in separate commits after the merge.
- **Lockfile:** write any `bun.lock` change with the bun version in the root `package.json`'s `packageManager` (1.3.10 today), since newer bun versions rewrite entries that upstream's lockfile keeps. Then check that `bun install --frozen-lockfile` with the latest bun, which CI uses, changes nothing.
- **Checks:** `bun run build`, `lint`, `lint:format`, `lint:circular` and `test`, with a Python that has `.github/requirements/requirements-execute.txt` installed so the execution tests run. CI's lint job also runs `bunx changeset version`; it rewrites files, so dry-run it in a throwaway worktree.
- **Fork footprint:** the set of files where the fork differs from upstream should be the same before and after, apart from intended follow-ups, and every SHA in `UPSTREAM-PRS.yml` should still be an ancestor of the branch.
- **Theme:** if the sync changes the site manifest or anything else a theme reads, build a small project with the books' pinned theme (QuantEcon/myst-theme `qe-vN`) before merging.
- **PR description:** why now, what it brings in (a table of the upstream commits), how it touches fork features, the conflict resolutions, and the verification. #144 and #156 are examples.
- **Copilot:** its review of a sync PR covers upstream's code, so don't act on it or reply. Only a comment on the fork's own lines (the conflict resolutions or a follow-up commit) needs a look.

CI also runs on `main` every week (Sundays 19:00 UTC) and can be started by hand from the CI workflow's page. GitHub pauses a scheduled workflow after 60 days without activity in the repository; if the weekly run stops, re-enable it from the Actions tab.

After the sync merges, the next tag follows the steps under [Maintaining `VERSION.yml`](#maintaining-versionyml).

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
- uses: actions/setup-node@v6
  with:
    node-version: '24'

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
