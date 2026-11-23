import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const plugin = require.resolve("@patodo/localapp/plugins/device-services");
const { parseDeviceActivationUrl } = require(path.resolve(path.dirname(plugin),
  "../runtime/server/node_modules/@localapp/dsh-device-services/dist/device-action-ticket.cjs"));

export async function resolveDeviceActivation(url, origin, controlToken) {
  const ticket = parseDeviceActivationUrl(url);
  const response = await fetch(origin + "/api/device-control/activations", {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json", "x-localapp-device-control": controlToken },
    body: JSON.stringify(ticket),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("本机无法接收该设备操作，请从来源应用重新发起");
  const body = await response.json();
  const id = body.data?.requestId;
  if (body.success !== true || body.data?.protocolVersion !== 2
    || typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error("设备操作返回无效");
  const confirmation = origin + "/my/device-actions/?requestId=" + id;
  if (body.data.confirmationUrl !== confirmation) throw new Error("设备操作确认地址无效");
  return confirmation;
}
