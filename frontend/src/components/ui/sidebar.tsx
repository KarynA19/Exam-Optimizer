import { PanelLeft, PanelLeftClose } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { Button } from "./button";

type SidebarItem = {
  key: string;
  title: string;
  subtitle?: string;
  complete?: boolean;
  icon?: LucideIcon;
  disabled?: boolean;
  children?: Array<{ key: string; title: string; icon?: LucideIcon; disabled?: boolean; complete?: boolean }>;
};

export function Sidebar({
  collapsed,
  title,
  subtitle,
  items,
  active,
  activeChild,
  onToggle,
  onSelect,
  onSelectChild,
}: {
  collapsed: boolean;
  title: string;
  subtitle: string;
  items: SidebarItem[];
  active: string;
  activeChild?: string;
  onToggle: () => void;
  onSelect: (key: string) => void;
  onSelectChild?: (key: string) => void;
}) {
  return (
    <aside className={cn("fixed left-0 top-0 z-50 h-screen overflow-y-auto border-r border-slate-200 bg-white transition-all", collapsed ? "w-20" : "w-72")}>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          {!collapsed ? (
            <div>
              <p className="text-sm font-semibold text-slate-900">{title}</p>
              <p className="text-xs text-slate-500">{subtitle}</p>
            </div>
          ) : null}
          <Button type="button" variant="ghost" size="icon" onClick={onToggle} aria-label="Toggle sidebar">
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>

        <nav className="space-y-1 p-3">
          {items.map((item) => (
            <div key={item.key} className="space-y-1">
              <button
                type="button"
                disabled={item.disabled}
                onClick={() => onSelect(item.key)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
                  item.disabled ? "cursor-not-allowed opacity-45" : "",
                  active === item.key ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100",
                )}
              >
                <span className="inline-flex items-center gap-2 truncate">
                  {item.icon ? <item.icon className="h-4 w-4" /> : null}
                  {collapsed ? item.title.slice(0, 1) : item.title}
                </span>
                {!collapsed && item.complete ? <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> : null}
              </button>

              {!collapsed && item.children && active === item.key ? (
                <div className="ml-5 space-y-1 border-l border-slate-200 pl-3">
                  {item.children.map((child) => (
                    <button
                      key={child.key}
                      type="button"
                      disabled={child.disabled}
                      onClick={() => onSelectChild?.(child.key)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm",
                        child.disabled ? "cursor-not-allowed opacity-45" : "",
                        activeChild === child.key ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100",
                      )}
                    >
                      <span className="inline-flex items-center gap-2 truncate">
                        {child.icon ? <child.icon className="h-4 w-4" /> : null}
                        {child.title}
                      </span>
                      {child.complete ? <span className="h-2 w-2 rounded-full bg-emerald-400" /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}
