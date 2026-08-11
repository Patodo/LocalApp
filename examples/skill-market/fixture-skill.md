# Fixture Skill

This deterministic fixture proves that an application can deliver a bounded skill file to the computer where the user clicked install.

## Contract

- The installer writes only below the selected target root.
- The action does not start a child process.
- The returned result includes the installed path, byte count, and SHA-256 digest.
