import type { ReactNode } from "react";
export type Selector<S> = <R>(selector: (state: S) => R) => R;
export type RenderSlot = (
  slot: string,
  props: Record<string, unknown>,
  options?: { fallback?: ReactNode; entryKey?: string; only?: string },
) => ReactNode;
export interface LayoutInfo {
  viewportWidth: number;
  sidebar: number;
  rightbar: number | null;
  narrowExpanded: boolean;
  rightbarShown: boolean;
  rightbarTrack: boolean;
  rightbarFullscreen: boolean;
  rightbarInstant: boolean;
}
export interface PanelInfo {
  activePanelId: string | null;
}
export interface Sessions {
  byId: Record<
    string,
    { id: string; title?: string; retainedBy: { mainView?: number } }
  >;
}
export interface AppFrameProps {
  useStore: Selector<{ layoutInfo: LayoutInfo }>;
  useSessions: Selector<Sessions>;
  usePanelInfo: Selector<PanelInfo>;
  actions: {
    setViewportWidth: (width: number) => void;
    setSidebar: (width: number) => void;
    setRightbar: (width: number) => void;
  };
  renderSlot: RenderSlot;
  t: (key: string) => string;
}
export interface SidebarRootComponentProps {
  collapsed: boolean;
  width: number;
  startSession: () => void;
  toggleSidebar: () => void;
  selectPanel: (id: string) => void;
  usePanels: Selector<Array<{ id: string; label: string }>>;
  useShortcuts: Selector<Array<{ id: string; keys: string[]; aria?: string }>>;
  usePanelInfo: Selector<PanelInfo>;
  t: (key: string) => string;
  renderSlot: RenderSlot;
}
export type PanelRowProps = Pick<
  SidebarRootComponentProps,
  "usePanelInfo" | "selectPanel" | "renderSlot"
> & { id: string; label: string; wide: boolean };
