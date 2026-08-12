#!/usr/bin/env bash
set -euo pipefail

image="${1:?usage: docker-release-smoke.sh <image>}"
suffix="$$-${RANDOM}"
server_container="localapp-release-server-${suffix}"
state_dir="${PWD}/tmp/docker-release-smoke-${suffix}"

cleanup() {
  docker rm -f "${server_container}" >/dev/null 2>&1 || true
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

host_port="$(docker port "${server_container}" 3000/tcp | sed -n 's/.*://p' | head -1)"
for _ in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:${host_port}/health" >/dev/null; then
    break
  fi
  sleep 1
done
curl --fail --silent "http://127.0.0.1:${host_port}/health" >/dev/null

docker exec "${server_container}" localapp --version | grep -Fq "${version_output}"

if docker exec "${server_container}" sh -c \
  "find /app /usr/local/lib/node_modules/localapp -type f \( -name 'localapp-cli-*' -o -name '*.msi' -o -name '*-setup.exe' \) -print -quit" \
  | grep -q .; then
  echo "runtime image contains a replaced CLI or installer artifact" >&2
  exit 1
fi
