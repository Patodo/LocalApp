# TypeScript Type Generation

## Problem
Agents manually define TypeScript interfaces (e.g. `interface Item { id: number; name: string; ... }`) based on schema definitions. This is error-prone and requires reading schema JSON then manually mapping types.

## Solution
`localapp schemas types` fetches all schemas from the server and generates TypeScript interfaces. Supports `-o` flag to write to a file. Field type mapping: string→string, number→number, boolean→boolean, timestamp→string, auto_increment→number. All interfaces include id/created_at/updated_at.

## Usage
```bash
localapp schemas types              # stdout
localapp schemas types -o src/types.ts  # write to file
```
