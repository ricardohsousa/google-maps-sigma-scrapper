#!/usr/bin/env bash
set -euo pipefail
export SIGMA_DEPLOY_FLAVOR=web
bash "$(dirname -- "${BASH_SOURCE[0]}")/../desktop/deploy-action.sh"
