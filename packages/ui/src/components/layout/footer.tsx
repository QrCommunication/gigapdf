import * as React from "react";
import { cn } from "../../lib/utils";

export interface FooterProps extends React.HTMLAttributes<HTMLElement> {
  leftContent?: React.ReactNode;
  rightContent?: React.ReactNode;
  ref?: React.Ref<HTMLElement>;
}

function Footer({ className, leftContent, rightContent, children, ref, ...props }: FooterProps) {
  return (
    <footer
      ref={ref}
      className={cn(
        "sticky bottom-0 z-40 w-full border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
        className
      )}
      {...props}
    >
      <div className="container flex h-12 items-center justify-between px-4">
        {leftContent && <div className="flex items-center gap-2">{leftContent}</div>}
        {children && <div className="flex flex-1 items-center justify-center">{children}</div>}
        {rightContent && <div className="flex items-center gap-2">{rightContent}</div>}
      </div>
    </footer>
  );
}

export { Footer };
