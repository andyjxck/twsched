#!/bin/bash
# Put the developer-login hiding live, in the order that never breaks the app:
# 1 data (developer flags), 2 functions, 3 website, 4 Firestore rules (last, once the app sends the filtered query).
set -eo pipefail
cd "$(dirname "$0")/../.."
export GOOGLE_APPLICATION_CREDENTIALS=/home/sprite/.config/gcloud-tws/adc_tws.json GOOGLE_CLOUD_QUOTA_PROJECT=twsched-f8b16
FB=/home/sprite/.npm/_npx/ba4f1959e38407b5/node_modules/.bin/firebase
echo "== 1 data"; NODE_PATH=/home/sprite/twsched-launch/tools/node_modules node tools/hide-developer/mark_developer.js --apply 2>&1 | grep -v Metadata
echo "== 2 functions"; $FB deploy --only functions --project twsched-f8b16 --non-interactive 2>&1 | tail -15
echo "== 3 hosting"; $FB deploy --only hosting --project twsched-f8b16 2>&1 | tail -4
echo "== 4 rules"; $FB deploy --only firestore:rules --project twsched-f8b16 2>&1 | tail -4
echo "== done"
