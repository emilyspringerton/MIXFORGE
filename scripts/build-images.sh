#!/usr/bin/env bash
# build-images.sh [TAG] — Cloud Build the mixforge-web and mixforge-room images from git-tracked files and push them
# to Artifact Registry. TAG defaults to the short git SHA (what CI passes). The in-cluster gitops-autodeploy cron
# (EMILY/gitops/watch-tags.sh, MIXFORGE_TAG) follows the newest mixforge-room tag, so web is pushed FIRST and room LAST:
# by the time the watcher sees the new room tag, the matching web tag already exists.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${1:-$(git -C "$SRC" rev-parse --short HEAD)}"
PROJECT="${PROJECT:-project-d24a71e9-2daf-4b2d-917}"
REG="us-central1-docker.pkg.dev/$PROJECT/emily"

build() { # name context-dir
  # CI SA constraints (EMILY/gitops/CI_SETUP.md): pin the staging dir, --async + poll instead of streaming logs.
  local id status
  id=$(gcloud builds submit "$2" --project "$PROJECT" --tag "$REG/$1:$TAG" \
    --gcs-source-staging-dir="gs://${PROJECT}_cloudbuild/source" --async --format="value(id)")
  echo "submitted $1 build $id, polling..."
  while true; do
    status=$(gcloud builds describe "$id" --project "$PROJECT" --format="value(status)")
    case "$status" in
      SUCCESS) echo "$1:$TAG"; return 0 ;;
      FAILURE|INTERNAL_ERROR|TIMEOUT|CANCELLED|EXPIRED) echo "build $id ($1): $status" >&2; return 1 ;;
      *) sleep 5 ;;
    esac
  done
}

tracked() { git -C "$SRC" ls-files -z -- "$@" | (cd "$SRC" && xargs -0 -r tar cf - 2>/dev/null); }

W="$(mktemp -d)"; R="$(mktemp -d)"; trap 'rm -rf "$W" "$R"' EXIT
mkdir -p "$W/site" "$R/server" "$R/web"
cp "$SRC/ops/docker/web/"{Dockerfile,default.conf} "$W/"
tracked web ':(exclude)web/*_test.mjs' | tar xf - -C "$W/site" --strip-components=1
cp "$SRC/ops/docker/room/Dockerfile" "$R/"
cp "$SRC/server/"{package.json,package-lock.json,room_server.mjs} "$R/server/"
tracked web | tar xf - -C "$R/web" --strip-components=1

build mixforge-web "$W"
build mixforge-room "$R"
