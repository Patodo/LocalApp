import { createClient, type LocalAppClient } from "@localapp/sdk";

let _client: LocalAppClient | null = null;
export function getClient(): LocalAppClient {
  if (!_client) _client = createClient();
  return _client;
}
