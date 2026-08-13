#!/usr/bin/env bash
set -euo pipefail

image="${1:?usage: docker-release-smoke.sh <image>}"
suffix="$$-${RANDOM}"
server_container="localapp-release-server-${suffix}"
state_dir="${PWD}/tmp/docker-release-smoke-${suffix}"

cleanup() {
  docker rm -f "${server_container}" >/dev/null 2>&1 || true
  docker run --rm --entrypoint sh \
    -v "${state_dir}:/app/data" \
    "${image}" \
    -c 'find /app/data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +' \
    >/dev/null 2>&1 || true
  rm -rf "${state_dir}"
}
trap cleanup EXIT
mkdir -p "${state_dir}"
chmod 0777 "${state_dir}"

version_output="$(docker run --rm --entrypoint localapp "${image}" --version)"
if [[ ! "${version_output}" =~ ^localapp[[:space:]][0-9]+\.[0-9]+\.[0-9]+ ]]; then
  echo "image does not expose the packaged localapp CLI" >&2
  exit 1
fi

docker run -d --name "${server_container}" \
  -p 127.0.0.1::3000 \
  -e BOOTSTRAP_API_KEY=test-docker-api-key \
  -e JWT_SECRET=test-docker-jwt-secret \
  -v "${state_dir}:/app/data" \
  "${image}" >/dev/null

health_check='const response = await fetch("http://127.0.0.1:3000/health"); const body = await response.json(); if (!response.ok || body.status !== "ok") process.exit(1);'
for _ in $(seq 1 30); do
  if docker exec "${server_container}" node --input-type=module --eval "${health_check}"; then
    break
  fi
  sleep 1
done
docker exec "${server_container}" node --input-type=module --eval "${health_check}"

docker exec "${server_container}" localapp --version | grep -Fq "${version_output}"

if docker exec "${server_container}" sh -c \
  "find /app /usr/local/lib/node_modules/@patodo/localapp -type f \( -name 'localapp-cli-*' -o -name '*.msi' -o -name '*-setup.exe' \) -print -quit" \
  | grep -q .; then
  echo "runtime image contains a replaced CLI or installer artifact" >&2
  exit 1
fi
