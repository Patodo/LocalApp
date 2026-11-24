import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";

export function registerShadowSessions(app: FastifyInstance, validateApiKey: (key: string) => string | null) {
  const secret = randomBytes(32);
  const lifetime = 15 * 60_000;
  app.addHook("onRequest", async (req, reply) => {
    const ticket = req.headers["x-localapp-shadow-session"];
    if (ticket === undefined) return;
    reply.header("Cache-Control", "no-store");
    try {
      if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{48,4096}$/.test(ticket)) throw new Error();
      const bytes = Buffer.from(ticket, "base64url");
      const decipher = createDecipheriv("aes-256-gcm", secret, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const session = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
      const route = req.url.split("?")[0];
      const decodedRoute = decodeURIComponent(route);
      if (/%2f|%5c/i.test(route) || decodedRoute.includes("\\") || decodedRoute.split("/").some(part => part === "." || part === "..")) throw new Error();
      const entry = `/${session.owner}/${session.name}`;
      const prefix = `/serve${entry}/`;
      const manifest = `/api/shadow${entry}/frontend`;
      const meta = `/api/pages${entry}/meta`;
      const readOnly = ["GET", "HEAD"].includes(req.method);
      const allowed = route.startsWith(prefix + "api/") || (readOnly && (
        [entry, entry + "/", prefix.slice(0, -1), manifest, meta, "/api/me"].includes(route) || route.startsWith(prefix)
      ));
      if (!allowed || session.expires <= Date.now() || validateApiKey(session.apiKey) !== session.id) throw new Error();
      req.visitorId = session.id;
      req.visitorName = session.owner;
      req.visitorRole = "user";
      req.authSessionTokenHash = null;
    } catch {
      return reply.code(401).send({ success: false, error: "Shadow session is invalid or expired" });
    }
  });
  return (apiKey: string, id: string, owner: string, name: string) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", secret, iv);
    const payload = JSON.stringify({ apiKey, id, owner, name, expires: Date.now() + lifetime });
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    return { ticket: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url"), expiresIn: lifetime };
  };
}
