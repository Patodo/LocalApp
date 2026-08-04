import { Check, Database, Download, LogOut, Power, RefreshCw, Server, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getDesktopGateway } from "../lib/desktop-gateway";
import type {
  AccountState,
  DesktopSettings,
  DesktopSettingsUpdate,
  DesktopUpdateInfo,
  ServerProfileSummary,
  TrustedApp,
} from "../lib/types";

export function SettingsView() {
  const gateway = getDesktopGateway();
  const [settings, setSettings] = useState<DesktopSettings>();
  const [account, setAccount] = useState<AccountState>();
  const [trustedApps, setTrustedApps] = useState<TrustedApp[]>([]);
  const [npmRegistry, setNpmRegistry] = useState("");
  const [httpProxy, setHttpProxy] = useState("");
  const [httpsProxy, setHttpsProxy] = useState("");
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const [update, setUpdate] = useState<DesktopUpdateInfo>();
  const [profiles, setProfiles] = useState<ServerProfileSummary[]>([]);
  const [profileName, setProfileName] = useState("");
  const [profileUrl, setProfileUrl] = useState("");
  const [profileKey, setProfileKey] = useState("");

  useEffect(() => {
    let disposed = false;
    void Promise.all([
      gateway.getSettings(),
      gateway.getAccount(),
      gateway.listTrustedApps(),
      gateway.listServerProfiles(),
    ])
      .then(([loadedSettings, loadedAccount, loadedTrusts, loadedProfiles]) => {
        if (disposed) return;
        setSettings(loadedSettings);
        setNpmRegistry(loadedSettings.npmRegistry ?? "https://registry.npmjs.org/");
        setAccount(loadedAccount);
        setTrustedApps(loadedTrusts);
        setProfiles(loadedProfiles);
      })
      .catch(() => {
        if (!disposed) setError("无法加载桌面端设置。");
      });
    return () => {
      disposed = true;
    };
  }, [gateway]);

  async function updatePreference(
    key: "notificationsEnabled" | "launchAtLogin",
    value: boolean,
  ) {
    if (!settings || pending) return;
    const previous = settings;
    setPending(key);
    setError(undefined);
    setSettings({ ...settings, [key]: value });
    try {
      setSettings(await gateway.updateSettings({ [key]: value }));
    } catch {
      setSettings(previous);
      setError("无法保存桌面端设置。");
    } finally {
      setPending(undefined);
    }
  }

  async function saveEnvironment() {
    if (!settings || pending) return;
    setPending("environment");
    setError(undefined);
    const update: DesktopSettingsUpdate = { npmRegistry };
    if (httpProxy) update.httpProxy = httpProxy;
    if (httpsProxy) update.httpsProxy = httpsProxy;
    try {
      setSettings(await gateway.updateSettings(update));
      setHttpProxy("");
      setHttpsProxy("");
    } catch {
      setError("无法保存脚本环境设置。");
    } finally {
      setPending(undefined);
    }
  }

  async function clearProxy(kind: "http" | "https") {
    if (!settings || pending) return;
    setPending(`${kind}-proxy`);
    setError(undefined);
    try {
      setSettings(await gateway.updateSettings(
        kind === "http" ? { clearHttpProxy: true } : { clearHttpsProxy: true },
      ));
    } catch {
      setError("无法清除代理设置。");
    } finally {
      setPending(undefined);
    }
  }

  async function toggleConnection() {
    if (!account || pending) return;
    setPending("connection");
    setError(undefined);
    try {
      if (account.connection === "offline") {
        await gateway.reconnectBus();
        setAccount({ ...account, connection: "connecting" });
      } else {
        await gateway.disconnectBus();
        setAccount({ ...account, connection: "offline" });
      }
    } catch {
      setError("无法更新账户连接。");
    } finally {
      setPending(undefined);
    }
  }

  async function revoke(trust: TrustedApp) {
    if (pending) return;
    setPending(`trust:${trust.serverOrigin}:${trust.appOwner}:${trust.appName}`);
    setError(undefined);
    try {
      await gateway.revokeAppTrust({
        serverOrigin: trust.serverOrigin,
        appOwner: trust.appOwner,
        appName: trust.appName,
        publisherUserId: trust.publisherUserId,
      });
      setTrustedApps((current) => current.filter((candidate) => candidate !== trust));
    } catch {
      setError("无法撤销应用信任。");
    } finally {
      setPending(undefined);
    }
  }

  async function checkForUpdates() {
    if (pending) return;
    setPending("update-check");
    setError(undefined);
    try {
      setUpdate(await gateway.checkForUpdates());
    } catch {
      setError("无法检查桌面端更新。");
    } finally {
      setPending(undefined);
    }
  }

  async function installUpdate() {
    if (pending || !update?.available) return;
    setPending("update-install");
    setError(undefined);
    try {
      await gateway.installUpdate();
    } catch {
      setError("无法安装桌面端更新。");
      setPending(undefined);
    }
  }

  async function runMaintenance(
    operation: "cache" | "logout" | "quit",
    action: () => Promise<void>,
    failureMessage: string,
  ) {
    if (pending) return;
    setPending(operation);
    setError(undefined);
    try {
      await action();
      setPending(undefined);
    } catch {
      setError(failureMessage);
      setPending(undefined);
    }
  }

  async function saveProfile() {
    if (pending || !profileName || !profileUrl || !profileKey) return;
    setPending("server-profile");
    setError(undefined);
    try {
      setProfiles(await gateway.saveServerProfile({
        name: profileName,
        serverUrl: profileUrl,
        apiKey: profileKey,
      }));
      setProfileName("");
      setProfileUrl("");
      setProfileKey("");
    } catch {
      setError("无法保存 Server profile，请检查名称、地址和 API Key。");
    } finally {
      setPending(undefined);
    }
  }

  async function removeProfile(name: string) {
    if (pending) return;
    setPending(`remove-profile:${name}`);
    setError(undefined);
    try {
      setProfiles(await gateway.removeServerProfile(name));
    } catch {
      setError("无法移除 Server profile。");
    } finally {
      setPending(undefined);
    }
  }

  async function useProfile(name: string) {
    if (pending) return;
    setPending(`use-profile:${name}`);
    setError(undefined);
    try {
      await gateway.useServerProfile(name);
    } catch {
      setError("无法切换当前 Server。");
      setPending(undefined);
    }
  }

  return (
    <div className="view-stack settings-view">
      <div className="page-heading">
        <h1>设置</h1>
        <p>管理账户连接、脚本环境与可信应用。</p>
      </div>
      {error ? <div className="message-error" role="alert">{error}</div> : null}
      <section className="settings-list" aria-label="桌面端偏好">
        <SettingRow title="账户连接" description={account?.serverUrl || "尚未配置 LocalApp 服务器。"}>
          <button className="secondary-button" disabled={!account || pending === "connection"} onClick={() => void toggleConnection()} type="button">
            {account?.connection === "offline" ? "重新连接" : "断开连接"}
          </button>
        </SettingRow>
        <SettingRow title="系统通知" description="允许 LocalApp 在系统通知中心显示新消息。">
          <PreferenceSwitch checked={settings?.notificationsEnabled ?? false} disabled={!settings || pending !== undefined} label="系统通知" onChange={(value) => void updatePreference("notificationsEnabled", value)} />
        </SettingRow>
        <SettingRow title="登录时启动" description="登录系统后自动启动 LocalApp 桌面端。">
          <PreferenceSwitch checked={settings?.launchAtLogin ?? false} disabled={!settings || pending !== undefined} label="登录时启动" onChange={(value) => void updatePreference("launchAtLogin", value)} />
        </SettingRow>
        <SettingRow
          title="客户端更新"
          description={update?.available ? `发现版本 ${update.version}` : update ? "当前已是最新版本。" : "检查签名发布渠道中的新版本。"}
        >
          {update?.available ? (
            <button className="primary-button" disabled={Boolean(pending)} onClick={() => void installUpdate()} type="button">
              <Download aria-hidden="true" size={16} />安装更新
            </button>
          ) : (
            <button className="secondary-button" disabled={Boolean(pending)} onClick={() => void checkForUpdates()} type="button">
              <RefreshCw aria-hidden="true" size={16} />检查更新
            </button>
          )}
        </SettingRow>
        <SettingRow title="依赖缓存" description="清除本机已准备的 JavaScript 依赖；运行中的任务不会被中断。">
          <button className="secondary-button" disabled={Boolean(pending)} onClick={() => void runMaintenance("cache", gateway.clearDependencyCache, "无法清除依赖缓存。") } type="button">
            <Database aria-hidden="true" size={16} />清除缓存
          </button>
        </SettingRow>
        <SettingRow title="账户" description={account?.displayName ? `${account.displayName} · ${account.serverUrl}` : "当前未登录。"}>
          <button className="secondary-button" disabled={Boolean(pending) || !account?.id} onClick={() => void runMaintenance("logout", gateway.logout, "无法退出登录。") } type="button">
            <LogOut aria-hidden="true" size={16} />退出登录
          </button>
        </SettingRow>
        <SettingRow title="退出客户端" description="停止通知、托盘连接与本地任务接收。">
          <button className="secondary-button" disabled={Boolean(pending)} onClick={() => void runMaintenance("quit", gateway.quitApp, "无法退出客户端。") } type="button">
            <Power aria-hidden="true" size={16} />退出程序
          </button>
        </SettingRow>
      </section>

      <section className="settings-section" aria-labelledby="script-environment-heading">
        <div className="section-heading">
          <h2 id="script-environment-heading">脚本环境</h2>
          <p>用于应用请求的 JavaScript 依赖下载。已保存的代理凭据不会回显。</p>
        </div>
        <div className="settings-form">
          <label><span>npm Registry</span><input aria-label="npm Registry" value={npmRegistry} onChange={(event) => setNpmRegistry(event.target.value)} type="url" /></label>
          <label>
            <span>HTTP 代理</span>
            <input aria-label="HTTP 代理" autoComplete="off" placeholder={settings?.httpProxyConfigured ? "已配置，输入新值可替换" : "http://proxy.example:8080"} value={httpProxy} onChange={(event) => setHttpProxy(event.target.value)} type="password" />
            {settings?.httpProxyConfigured ? <small>已配置 HTTP 代理</small> : null}
          </label>
          <label>
            <span>HTTPS 代理</span>
            <input aria-label="HTTPS 代理" autoComplete="off" placeholder={settings?.httpsProxyConfigured ? "已配置，输入新值可替换" : "http://proxy.example:8080"} value={httpsProxy} onChange={(event) => setHttpsProxy(event.target.value)} type="password" />
            {settings?.httpsProxyConfigured ? <small>已配置 HTTPS 代理</small> : null}
          </label>
          <div className="settings-form-actions">
            {settings?.httpProxyConfigured ? <button className="text-button" onClick={() => void clearProxy("http")} type="button">清除 HTTP 代理</button> : null}
            {settings?.httpsProxyConfigured ? <button className="text-button" onClick={() => void clearProxy("https")} type="button">清除 HTTPS 代理</button> : null}
            <button className="primary-button" disabled={!settings || Boolean(pending)} onClick={() => void saveEnvironment()} type="button">保存脚本环境</button>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="server-profiles-heading">
        <div className="section-heading">
          <h2 id="server-profiles-heading">发布服务器</h2>
          <p>为应用发布保存命名目标。API Key 只保存在本机 Rust 配置中，不会回显。</p>
        </div>
        <div className="server-profile-list">
          {profiles.length === 0 ? (
            <div className="trusted-empty"><Server aria-hidden="true" size={19} />尚未配置发布服务器</div>
          ) : profiles.map((profile) => (
            <div className="server-profile-row" key={profile.name}>
              <div>
                <strong>{profile.name}</strong>
                <span>{profile.serverUrl}</span>
              </div>
              <div className="profile-row-actions">
                {profile.active ? (
                  <span className="active-profile"><Check aria-hidden="true" size={14} />当前</span>
                ) : (
                  <button className="text-button" disabled={Boolean(pending)} onClick={() => void useProfile(profile.name)} type="button">设为当前</button>
                )}
                <button aria-label={`移除 ${profile.name}`} className="icon-button" disabled={Boolean(pending)} onClick={() => void removeProfile(profile.name)} title="移除 Server profile" type="button"><Trash2 aria-hidden="true" size={16} /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="settings-form server-profile-form">
          <label><span>名称</span><input aria-label="Profile 名称" autoComplete="off" placeholder="production" value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label>
          <label><span>Server URL</span><input aria-label="Profile Server URL" autoComplete="url" placeholder="https://work.example" type="url" value={profileUrl} onChange={(event) => setProfileUrl(event.target.value)} /></label>
          <label><span>API Key</span><input aria-label="Profile API Key" autoComplete="off" placeholder="仅写入本机" type="password" value={profileKey} onChange={(event) => setProfileKey(event.target.value)} /></label>
          <div className="settings-form-actions">
            <button className="primary-button" disabled={Boolean(pending) || !profileName || !profileUrl || !profileKey} onClick={() => void saveProfile()} type="button">保存 Server</button>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="trusted-apps-heading">
        <div className="section-heading">
          <h2 id="trusted-apps-heading">可信应用</h2>
          <p>撤销只影响该应用和发布者后续发起的任务。</p>
        </div>
        {trustedApps.length === 0 ? (
          <div className="trusted-empty"><ShieldCheck aria-hidden="true" size={19} />尚未信任任何应用</div>
        ) : (
          <div className="trusted-list">
            {trustedApps.map((trust) => (
              <div className="trusted-row" key={`${trust.serverOrigin}:${trust.appOwner}:${trust.appName}:${trust.publisherUserId}`}>
                <div><strong>{trust.appOwner}/{trust.appName}</strong><span>{trust.publisherDisplayName || trust.publisherUserId}</span><small>{trust.serverOrigin}</small></div>
                <button aria-label={`撤销 ${trust.appOwner}/${trust.appName} 的信任`} className="icon-button" onClick={() => void revoke(trust)} title="撤销信任" type="button"><Trash2 aria-hidden="true" size={17} /></button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="setting-row"><div><h2>{title}</h2><p>{description}</p></div>{children}</div>;
}

function PreferenceSwitch({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: (value: boolean) => void }) {
  return <label className="preference-switch"><input aria-label={label} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} role="switch" type="checkbox" /><span aria-hidden="true" /></label>;
}
