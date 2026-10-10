#!/usr/bin/env bash
set -euo pipefail

# Hosted development tests require network namespaces, not the Landlock fallback.
sudo apt-get update -qq
sudo apt-get install -y bubblewrap apparmor

if ! bwrap --ro-bind / / --unshare-net -- true; then
  # Ubuntu 24.04 requires a profile allowing user namespaces for this executable.
  # Keep the host-wide AppArmor setting enabled; allow only the sandbox launcher.
  sudo tee /etc/apparmor.d/localapp-ci-bwrap >/dev/null <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>
profile localapp-ci-bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
}
PROFILE
  sudo apparmor_parser -r /etc/apparmor.d/localapp-ci-bwrap
fi

# Fail during setup if the runner still cannot enforce network isolation.
bwrap --ro-bind / / --unshare-net -- true
