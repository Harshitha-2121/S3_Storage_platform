#!/usr/bin/env bash
# Install Caddy and TLS-front (internal CA) the app + Convex API + Convex site.
set -uo pipefail

if ! command -v caddy >/dev/null 2>&1; then
  echo "=== install caddy ==="
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null 2>&1
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null 2>&1
fi
caddy version

cat > /etc/caddy/Caddyfile <<'EOF'
{
	auto_https disable_redirects
}
https://10.1.30.14 {
	tls internal
	reverse_proxy 127.0.0.1:3000
}
https://10.1.30.14:3215 {
	tls internal
	reverse_proxy 127.0.0.1:3210
}
https://10.1.30.14:3216 {
	tls internal
	reverse_proxy 127.0.0.1:3211
}
EOF

systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy
sleep 6
echo "caddy=$(systemctl is-active caddy)"
echo "=== curl -k checks ==="
curl -sk -o /dev/null -w "app 443 /en/login: %{http_code}\n" https://10.1.30.14/en/login
curl -sk -o /dev/null -w "convex 3215 /version: %{http_code}\n" https://10.1.30.14:3215/version
curl -sk -o /dev/null -w "site 3216 jwks: %{http_code}\n" https://10.1.30.14:3216/.well-known/jwks.json
echo "=== caddy root CA ==="
find /var/lib/caddy /root -name root.crt -path '*caddy*pki*' 2>/dev/null | head
echo CADDY_DONE
