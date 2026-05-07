#!/usr/bin/env bash
# quantecon/build.sh
#
# Rebuilds the `quantecon` integration branch by merging all active feature
# branches (listed in quantecon/features.txt) on top of current `main`.
#
# Usage:
#   ./quantecon/build.sh [--push]
#
# Options:
#   --push    Push the resulting branch to origin after a successful build.
#
# Conflict resolution:
#   This script aborts cleanly on any merge conflict. Conflicts must be
#   resolved on the feature branch itself (never on `quantecon`):
#
#   Feature vs. main:
#     git checkout <branch> && git rebase main
#     # resolve conflicts, git add, git rebase --continue
#     git push --force-with-lease origin <branch>
#     ./quantecon/build.sh [--push]
#
#   Feature A vs. feature B:
#     git checkout <branch-B> && git rebase <branch-A>
#     # resolve conflicts, update features.txt so branch-A appears before branch-B
#     git push --force-with-lease origin <branch-B>
#     ./quantecon/build.sh [--push]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FEATURES_FILE="$SCRIPT_DIR/features.txt"
INTEGRATION_BRANCH="quantecon"
BASE_BRANCH="main"
PUSH=false

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "ERROR: not inside a git repository." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: working tree is dirty. Commit or stash changes before running." >&2
  exit 1
fi

# Read feature branches (strip comments and blank lines, extract first token)
mapfile -t FEATURES < <(awk '/^[[:space:]]*#/{next} /^[[:space:]]*$/{next} {print $1}' "$FEATURES_FILE")

if [[ ${#FEATURES[@]} -eq 0 ]]; then
  echo "No feature branches listed in $FEATURES_FILE. Nothing to do."
  exit 0
fi

echo "==> Feature branches to merge:"
for f in "${FEATURES[@]}"; do
  echo "    $f"
done

# ---------------------------------------------------------------------------
# Ensure local main is up to date
# ---------------------------------------------------------------------------
echo ""
echo "==> Fetching origin..."
git fetch origin

echo ""
echo "==> Switching to $BASE_BRANCH and fast-forwarding from origin..."
git checkout "$BASE_BRANCH"
# main should be a pure upstream mirror — ff-only guards against accidental commits
if ! git merge --ff-only origin/"$BASE_BRANCH"; then
  echo "ERROR: could not fast-forward $BASE_BRANCH from origin/$BASE_BRANCH." \
       "Sync main with upstream first (git merge upstream/main && git push origin main)." >&2
  exit 1
fi

BASE_SHA=$(git rev-parse "$BASE_BRANCH")
echo "    Base commit: $BASE_SHA"

# ---------------------------------------------------------------------------
# Verify all feature branches exist (locally or on origin)
# ---------------------------------------------------------------------------
echo ""
echo "==> Verifying feature branches exist..."
for branch in "${FEATURES[@]}"; do
  if git rev-parse --verify "$branch" > /dev/null 2>&1; then
    echo "    $branch (local)"
  elif git rev-parse --verify "origin/$branch" > /dev/null 2>&1; then
    # Create a local tracking branch so 'git merge <branch>' works
    git branch --track "$branch" "origin/$branch" 2>/dev/null || git branch -f "$branch" "origin/$branch"
    echo "    $branch (fetched from origin)"
  else
    echo "ERROR: branch '$branch' not found locally or on origin." >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Rebuild the integration branch
# ---------------------------------------------------------------------------
echo ""
echo "==> Resetting '$INTEGRATION_BRANCH' to '$BASE_BRANCH'..."
git checkout -B "$INTEGRATION_BRANCH" "$BASE_BRANCH"

MERGED=()
for branch in "${FEATURES[@]}"; do
  echo ""
  echo "==> Merging $branch..."
  if git merge --no-ff "$branch" -m "chore: merge $branch into $INTEGRATION_BRANCH"; then
    MERGED+=("$branch")
  else
    echo "" >&2
    echo "ERROR: merge conflict when merging '$branch'." >&2
    echo "" >&2
    echo "Conflicting files:" >&2
    git diff --name-only --diff-filter=U >&2
    echo "" >&2
    echo "Aborting. The '$INTEGRATION_BRANCH' branch has been reset; no changes were pushed." >&2
    git merge --abort
    git checkout "$BASE_BRANCH"
    git branch -D "$INTEGRATION_BRANCH"
    echo "" >&2
    echo "How to fix:" >&2
    if [[ ${#MERGED[@]} -gt 0 ]]; then
      echo "  '$branch' conflicts with one of: ${MERGED[*]}" >&2
      echo "  Rebase '$branch' on top of the conflicting branch:" >&2
      echo "    git checkout $branch && git rebase <earlier-branch>" >&2
      echo "  Then update features.txt so the earlier branch appears first." >&2
    else
      echo "  '$branch' conflicts with $BASE_BRANCH." >&2
      echo "  Rebase it: git checkout $branch && git rebase $BASE_BRANCH" >&2
    fi
    echo "  Resolve conflicts, push the feature branch, then re-run this script." >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Patch version string with -qe suffix
# ---------------------------------------------------------------------------
# version.ts is generated/gitignored — patch packages/mystmd/package.json instead.
# The copy:version build step will propagate the version to version.ts at build time.
PACKAGE_JSON="packages/mystmd/package.json"
echo ""
echo "==> Patching version in $PACKAGE_JSON with '-qe' suffix..."

CURRENT_VERSION=$(node -p "require('./$PACKAGE_JSON').version")
QE_VERSION="${CURRENT_VERSION}-qe"

# Use node to patch the JSON safely (avoids sed quoting issues with JSON)
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('$PACKAGE_JSON', 'utf8'));
  pkg.version = '$QE_VERSION';
  fs.writeFileSync('$PACKAGE_JSON', JSON.stringify(pkg, null, 2) + '\n');
"

git add "$PACKAGE_JSON"
git commit -m "chore: set version to ${QE_VERSION} for QuantEcon build"
echo "    Version set to ${QE_VERSION}"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "==> Build successful."
echo "    Branch '$INTEGRATION_BRANCH' contains $BASE_BRANCH + ${#MERGED[@]} feature branch(es):"
for f in "${MERGED[@]}"; do
  echo "      $f"
done
echo "    Version: ${QE_VERSION}"

# ---------------------------------------------------------------------------
# Optionally push
# ---------------------------------------------------------------------------
if $PUSH; then
  echo ""
  echo "==> Pushing '$INTEGRATION_BRANCH' to origin (force-with-lease)..."
  git push --force-with-lease origin "$INTEGRATION_BRANCH"
  echo "    Done."
else
  echo ""
  echo "Tip: run with --push to push to origin/$INTEGRATION_BRANCH."
fi

git checkout "$BASE_BRANCH"
