import { dialog, globalShortcut } from "electron";

export function readShortcutDeclarations(manifest) {
  const shortcuts = manifest.desktop?.shortcuts ?? [];
  if (!Array.isArray(shortcuts) || shortcuts.length > 16) throw new Error("Invalid desktop shortcuts");
  const ids = new Set();
  return shortcuts.map(({ id, label, accelerator, route }) => {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || typeof id !== "string" || ids.has(id)
      || typeof label !== "string" || !label.trim() || label.length > 80
      || typeof accelerator !== "string" || !/^(?:(?:CommandOrControl|Control|Alt|Shift|Super)\+){1,4}(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(accelerator)
      || typeof route !== "string" || !/^\?(?:[A-Za-z0-9_-]+=[A-Za-z0-9_-]+)(?:&[A-Za-z0-9_-]+=[A-Za-z0-9_-]+)*$/.test(route)) {
      throw new Error("Invalid desktop shortcut declaration");
    }
    ids.add(id);
    return { id, label, accelerator, route };
  });
}

function keyFor(accelerator) {
  const parts = accelerator.toUpperCase().replace("COMMANDORCONTROL", process.platform === "darwin" ? "SUPER" : "CONTROL").split("+");
  return [...new Set(parts)].sort().join("+");
}

export class DesktopShortcuts {
  #active = new Map();
  #changing = false;

  isEnabled(id) {
    return [...this.#active.values()].some(shortcut => shortcut.id === id);
  }

  async enable(window, shortcut) {
    if (this.#changing) return false;
    this.#changing = true;
    try {
      const key = keyFor(shortcut.accelerator);
      const existing = this.#active.get(key);
      if (existing?.id === shortcut.id) return true;
      if (existing) {
        const { response } = await dialog.showMessageBox(window, {
          type: "warning",
          title: "全局快捷键冲突",
          message: `${shortcut.accelerator} 只能启用一个动作`,
          buttons: [`保留 ${existing.label}`, `改为 ${shortcut.label}`],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (response !== 1) return false;
        globalShortcut.unregister(existing.accelerator);
      }
      let registered = false;
      try {
        registered = globalShortcut.register(shortcut.accelerator, shortcut.run);
      } catch {
        // Electron also throws for unsupported combinations.
      }
      if (registered) {
        this.#active.set(key, shortcut);
        existing?.onDisabled?.();
        return true;
      }
      this.#active.delete(key);
      if (existing && globalShortcut.register(existing.accelerator, existing.run)) {
        this.#active.set(key, existing);
      }
      await dialog.showMessageBox(window, {
        type: "warning",
        message: `系统未能注册 ${shortcut.accelerator}`,
        detail: "该组合键可能已被系统或其他应用使用。",
      });
      return false;
    } finally {
      this.#changing = false;
    }
  }

  disable(id) {
    for (const [key, shortcut] of this.#active) {
      if (shortcut.id !== id) continue;
      globalShortcut.unregister(shortcut.accelerator);
      this.#active.delete(key);
    }
  }

  clear() {
    globalShortcut.unregisterAll();
    this.#active.clear();
  }
}
