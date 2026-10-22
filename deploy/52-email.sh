#!/usr/bin/env bash
# Route auth emails to local Mailpit via nodemailer (Node SMTP action). Prove one lands.
set -uo pipefail
export PATH=$HOME/.bun/bin:$PATH
N=/usr/bin/node; C=/opt/myos/node_modules/convex/bin/main.js
echo "=== add nodemailer ==="
( cd /opt/myos/packages/backend && bun add nodemailer 2>&1 | tail -2 )
cp /tmp/email.ts             /opt/myos/packages/backend/convex/email.ts
cp /tmp/ResendOTP.ts         /opt/myos/packages/backend/convex/ResendOTP.ts
cp /tmp/passwordProviders.ts /opt/myos/packages/backend/convex/passwordProviders.ts
rm -f /opt/myos/packages/backend/convex/nodetest.ts
cd /opt/myos/packages/backend
echo "=== set SMTP env (-> Mailpit) ==="
"$N" "$C" env set SMTP_HOST 10.1.30.14 >/dev/null && echo "SMTP_HOST set"
"$N" "$C" env set SMTP_PORT 1025 >/dev/null && echo "SMTP_PORT set"
"$N" "$C" env set SMTP_FROM "auth@myos.local" >/dev/null && echo "SMTP_FROM set"
echo "=== deploy ==="
"$N" "$C" deploy -y 2>&1 | tail -3
echo "=== trigger a signup -> verification email ==="
EM="mailtest$(date +%s)@myos.test"
echo "to: $EM"
"$N" "$C" run auth:signIn "{\"provider\":\"password\",\"params\":{\"email\":\"$EM\",\"password\":\"MailTest#2026\",\"flow\":\"signUp\"}}" >/dev/null 2>&1
sleep 5
echo "=== Mailpit inbox ==="
curl -s "http://localhost:8025/api/v1/messages?limit=3" | tr ',' '\n' | grep -iE '"total"|"Subject"|"Address"' | head -8
echo MAIL_TEST_DONE
