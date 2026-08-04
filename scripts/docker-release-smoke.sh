#!/usr/bin/env bash
set -euo pipefail

image="${1:?usage: docker-release-smoke.sh <image>}"
suffix="$$-${RANDOM}"
network="localapp-release-smoke-${suffix}"
fixture_container="localapp-release-fixture-${suffix}"
server_container="localapp-release-server-${suffix}"
fixture_dir="$(mktemp -d)"

cleanup() {
  docker rm -f "${server_container}" "${fixture_container}" >/dev/null 2>&1 || true
  docker network rm "${network}" >/dev/null 2>&1 || true
  rm -rf "${fixture_dir}"
}
trap cleanup EXIT

asset="localapp-cli-x86_64-unknown-linux-gnu"
printf 'localapp-release-smoke\n' > "${fixture_dir}/${asset}"
asset_size="$(wc -c < "${fixture_dir}/${asset}" | tr -d ' ')"
asset_sha="$(shasum -a 256 "${fixture_dir}/${asset}" | awk '{print $1}')"
version="$(sed -n 's/^version = "\(.*\)"/\1/p' packages/cli/Cargo.toml | head -1)"

cat > "${fixture_dir}/release-manifest.json" <<EOF
{
  "schemaVersion": 1,
  "latest": "${version}",
  "min": "${version}",
  "generatedAt": "2026-07-30T00:00:00.000Z",
  "assets": [{
    "kind": "cli",
    "version": "${version}",
    "os": "linux",
    "arch": "x86_64",
    "filename": "${asset}",
    "url": "https://release-fixture:8443/${asset}",
    "size": ${asset_size},
    "sha256": "${asset_sha}",
    "signature": "unsigned"
  }]
}
EOF

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "${fixture_dir}/tls.key" \
  -out "${fixture_dir}/tls.crt" \
  -days 1 \
  -subj "/CN=release-fixture" \
  -addext "subjectAltName=DNS:release-fixture" >/dev/null 2>&1

cat > "${fixture_dir}/fixture-server.mjs" <<'EOF'
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

const root = "/fixtures";
https.createServer({
  key: fs.readFileSync(path.join(root, "tls.key")),
  cert: fs.readFileSync(path.join(root, "tls.crt")),
}, (request, response) => {
  const requested = decodeURIComponent(new URL(request.url, "https://release-fixture:8443").pathname);
  const filename = path.basename(requested);
  if (!filename || filename !== requested.slice(1)) {
    response.writeHead(404).end();
    return;
  }
  const file = path.join(root, filename);
  if (!fs.existsSync(file)) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "content-type": filename.endsWith(".json") ? "application/json" : "application/octet-stream",
    "content-length": fs.statSync(file).size,
  });
  fs.createReadStream(file).pipe(response);
}).listen(8443, "0.0.0.0");
EOF

docker network create "${network}" >/dev/null
docker run -d --name "${fixture_container}" \
  --network "${network}" \
  --network-alias release-fixture \
  --user 0:0 \
  -v "${fixture_dir}:/fixtures:ro" \
  --entrypoint node \
  "${image}" /fixtures/fixture-server.mjs >/dev/null

docker run -d --name "${server_container}" \
  --network "${network}" \
  -p 127.0.0.1::3000 \
  -e BOOTSTRAP_API_KEY=test-docker-api-key \
  -e JWT_SECRET=test-docker-jwt-secret \
  -e LOCALAPP_RELEASE_MANIFEST_URL=https://release-fixture:8443/release-manifest.json \
  -e NODE_EXTRA_CA_CERTS=/certs/release-fixture.crt \
  -v "${fixture_dir}/tls.crt:/certs/release-fixture.crt:ro" \
  "${image}" >/dev/null

host_port="$(docker port "${server_container}" 3000/tcp | sed -n 's/.*://p' | head -1)"
for _ in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:${host_port}/health" >/dev/null; then
    break
  fi
  sleep 1
done
curl --fail --silent "http://127.0.0.1:${host_port}/health" >/dev/null

version_json="$(curl --fail --silent \
  -H 'X-API-Key: test-docker-api-key' \
  "http://127.0.0.1:${host_port}/api/cli/version")"
node -e '
  const body = JSON.parse(process.argv[1]);
  if (body.latest !== process.argv[2] || body.assets?.length !== 1) process.exit(1);
' "${version_json}" "${version}"

headers="$(curl --silent --dump-header - --output /dev/null \
  -H 'X-API-Key: test-docker-api-key' \
  "http://127.0.0.1:${host_port}/api/cli/download?os=linux&arch=x86_64")"
grep -q '^HTTP/1.1 307' <<<"${headers}"
grep -qi '^location: https://release-fixture:8443/' <<<"${headers}"
grep -qi "^x-localapp-asset-sha256: ${asset_sha}" <<<"${headers}"

if docker exec "${server_container}" sh -c \
  "find /app -type f \\( -name 'localapp-cli-*' -o -name '*.msi' -o -name '*-setup.exe' -o -name '.registration-key' \\) -print -quit" \
  | grep -q .; then
  echo "runtime image contains a forbidden client binary or registration key" >&2
  exit 1
fi

if docker history --no-trunc "${image}" | grep -Ei 'registration[_ -]?key|\\.registration-key'; then
  echo "runtime image history contains registration key material" >&2
  exit 1
fi
