#!/usr/bin/env bash
# /opt/write_rclone_conf.sh — generate the rclone config for R2 from env.
#
# Reads:
#   R2_ACCOUNT_ID         Cloudflare R2 account id (subdomain in endpoint URL)
#   AWS_ACCESS_KEY_ID     R2 S3-compatible access key
#   AWS_SECRET_ACCESS_KEY R2 S3-compatible secret
#
# Writes /root/.config/rclone/rclone.conf with mode 600. The remote is
# named `r2` so other scripts can address it as `r2:bucket/path`.

set -Eeuo pipefail

: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID env var required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID env var required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY env var required}"

CONF_DIR=/root/.config/rclone
mkdir -p "$CONF_DIR"
CONF_FILE="$CONF_DIR/rclone.conf"

cat > "$CONF_FILE" <<EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = ${AWS_ACCESS_KEY_ID}
secret_access_key = ${AWS_SECRET_ACCESS_KEY}
endpoint = https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
acl = private
no_check_bucket = true
EOF

chmod 600 "$CONF_FILE"
echo "rclone.conf written → $CONF_FILE"
