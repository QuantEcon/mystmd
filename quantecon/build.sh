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

# Read feature branches (strip comments and blank lines)
mapfile -t FEATURES < <(grep -v '^\s*#' "$FEATURES_FILE" | grep -v '^\s*$' | awk '{print $1}')

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
echo "==> Switching to $BASE_BRANCH and fast-forwarding..."
git checkout "$BASE_BRANCH"
git merge --ff-only origin/"$BASE_BRANCH" 2>/dev/null || {
  echo "WARN: could not fast-forward $BASE_BRANCH from origin/$BASE_BRANCH." \
       "Proceeding with local state."
}

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
    echo "    $branch (origin)"
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
VERSION_FILE="packages/mystmd/src/version.ts"
echo ""
echo "==> Patching version in $VERSION_FILE with '-qe' suffix..."

CURRENT_VERSION=$(node -p "require('./packages/mystmd/package.json').version")
QE_VERSION="${CURRENT_VERSION}-qe"

# Replace the version string in version.ts (matches: const version = 'X.Y.Z';)
sed -i.bak "s/const version = '[^']*'/const version = '${QE_VERSION}'/" "$VERSION_FILE"
rm -f "${VERSION_FILE}.bak"

git add "$VERSION_FILE"
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
