"use client";

import { Copy, KeyRound, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface OneTimeCredentialsDialogProps {
  username?: string;
  temporaryPassword: string;
  apiKey?: string;
  onClose: () => void;
}

async function copyText(value: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch {
    toast.error("复制失败");
  }
}

export function OneTimeCredentialsDialog({
  username,
  temporaryPassword,
  apiKey,
  onClose,
}: OneTimeCredentialsDialogProps) {
  const allCredentials = [
    username ? `用户名: ${username}` : null,
    `临时密码: ${temporaryPassword}`,
    apiKey ? `API Key: ${apiKey}` : null,
  ].filter(Boolean).join("\n");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card
        className="w-full max-w-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="one-time-credentials-title"
      >
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 id="one-time-credentials-title" className="font-semibold leading-none">
              一次性凭据
            </h2>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>请立即保存这些凭据，关闭后无法再次查看。</span>
          </div>

          {username && (
            <CredentialRow label="用户名" value={username} />
          )}
          <CredentialRow
            label="临时密码"
            value={temporaryPassword}
            actionLabel="复制临时密码"
            onCopy={() => copyText(temporaryPassword, "临时密码已复制")}
          />
          {apiKey && (
            <CredentialRow
              label="API Key"
              value={apiKey}
              actionLabel="复制 API Key"
              onCopy={() => copyText(apiKey, "API Key 已复制")}
            />
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            {apiKey && (
              <Button
                variant="outline"
                onClick={() => copyText(allCredentials, "凭据已复制")}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                复制全部
              </Button>
            )}
            <Button onClick={onClose}>我已保存，关闭</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface CredentialRowProps {
  label: string;
  value: string;
  actionLabel?: string;
  onCopy?: () => void;
}

function CredentialRow({ label, value, actionLabel, onCopy }: CredentialRowProps) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 text-sm">
          {value}
        </code>
        {onCopy && actionLabel && (
          <Button
            size="sm"
            variant="outline"
            aria-label={actionLabel}
            title={actionLabel}
            onClick={onCopy}
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
