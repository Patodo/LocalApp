import { AppSettingsRoute } from "./route-client";

export function generateStaticParams() {
  return [{ name: "placeholder" }];
}

export default function AppSettingsRoutePage() {
  return <AppSettingsRoute />;
}
