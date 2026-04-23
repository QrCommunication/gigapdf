import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";

const toolbarButtonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-transparent hover:bg-accent hover:text-accent-foreground",
        active: "bg-accent text-accent-foreground",
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 px-2",
        lg: "h-10 px-4",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ToolbarButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof toolbarButtonVariants> {
  active?: boolean;
  tooltip?: string;
  icon?: React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}

function ToolbarButton({ className, variant, size, active, tooltip, icon, children, ref, ...props }: ToolbarButtonProps) {
  const button = (
    <button
      className={cn(
        toolbarButtonVariants({
          variant: active ? "active" : variant,
          size,
          className,
        })
      )}
      ref={ref}
      aria-pressed={active}
      {...props}
    >
      {icon && <span className={cn(children && "mr-2")}>{icon}</span>}
      {children}
    </button>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
}

export { ToolbarButton, toolbarButtonVariants };
