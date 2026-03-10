import * as React from "react";
import { cn } from "../../lib/utils";
import { Separator } from "../ui/separator";

export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
}

const Toolbar = React.forwardRef<HTMLDivElement, ToolbarProps>(
  ({ className, orientation = "horizontal", children, ...props }, ref) => {
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
);
Toolbar.displayName = "Toolbar";

const ToolbarGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { orientation?: "horizontal" | "vertical" }
>(({ className, orientation = "horizontal", children, ...props }, ref) => {
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
});
ToolbarGroup.displayName = "ToolbarGroup";

const ToolbarSeparator = React.forwardRef<
  React.ElementRef<typeof Separator>,
  React.ComponentPropsWithoutRef<typeof Separator>
>(({ className, orientation = "vertical", ...props }, ref) => {
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
});
ToolbarSeparator.displayName = "ToolbarSeparator";

export { Toolbar, ToolbarGroup, ToolbarSeparator };
