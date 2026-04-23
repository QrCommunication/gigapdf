import * as React from "react";
import { cn } from "../../lib/utils";
import { Separator } from "../ui/separator";

export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
  ref?: React.Ref<HTMLDivElement>;
}

function Toolbar({ className, orientation = "horizontal", children, ref, ...props }: ToolbarProps) {
  return (
    <div
      ref={ref}
      className={cn(
        "flex gap-1 bg-background p-2",
        orientation === "horizontal" ? "flex-row items-center" : "flex-col items-start",
        className
      )}
      role="toolbar"
      {...props}
    >
      {children}
    </div>
  );
}

interface ToolbarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
  ref?: React.Ref<HTMLDivElement>;
}

function ToolbarGroup({ className, orientation = "horizontal", children, ref, ...props }: ToolbarGroupProps) {
  return (
    <div
      ref={ref}
      className={cn(
        "flex gap-1",
        orientation === "horizontal" ? "flex-row items-center" : "flex-col items-start",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface ToolbarSeparatorProps extends React.ComponentPropsWithoutRef<typeof Separator> {
  ref?: React.Ref<React.ElementRef<typeof Separator>>;
}

function ToolbarSeparator({ className, orientation = "vertical", ref, ...props }: ToolbarSeparatorProps) {
  return (
    <Separator
      ref={ref}
      orientation={orientation}
      className={cn(
        orientation === "vertical" ? "mx-1 h-6" : "my-1 w-full",
        className
      )}
      {...props}
    />
  );
}

export { Toolbar, ToolbarGroup, ToolbarSeparator };
