import * as React from "react";
import { cn } from "../../lib/utils";

export interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  side?: "left" | "right";
  collapsible?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

const Sidebar = React.forwardRef<HTMLElement, SidebarProps>(
  (
    {
      className,
      side = "left",
      collapsible = false,
      collapsed = false,
      onCollapsedChange,
      children,
      ...props
    },
    ref
  ) => {
    const [isCollapsed, setIsCollapsed] = React.useState(collapsed);

    React.useEffect(() => {
      setIsCollapsed(collapsed);
    }, [collapsed]);

    const handleCollapse = () => {
      const newState = !isCollapsed;
      setIsCollapsed(newState);
      onCollapsedChange?.(newState);
    };

    return (
      <aside
        ref={ref}
        className={cn(
          "flex flex-col border-r bg-background transition-all duration-300",
          side === "right" && "border-l border-r-0",
          isCollapsed ? "w-16" : "w-64",
          className
        )}
        {...props}
      >
        {collapsible && (
          <button
            onClick={handleCollapse}
            className="flex h-14 items-center justify-center border-b hover:bg-accent"
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg
              className={cn(
                "h-4 w-4 transition-transform",
                isCollapsed && side === "left" && "rotate-180",
                !isCollapsed && side === "right" && "rotate-180"
              )}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={side === "left" ? "M15 19l-7-7 7-7" : "M9 5l7 7-7 7"}
              />
            </svg>
          </button>
        )}
        <div className="flex-1 overflow-auto p-4">{children}</div>
      </aside>
    );
  }
);
Sidebar.displayName = "Sidebar";

export { Sidebar };
