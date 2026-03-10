import * as React from "react";
import { cn } from "../../lib/utils";

export interface HeaderProps extends React.HTMLAttributes<HTMLElement> {
  logo?: React.ReactNode;
  actions?: React.ReactNode;
}

const Header = React.forwardRef<HTMLElement, HeaderProps>(
  ({ className, logo, actions, children, ...props }, ref) => {
    return (
      <header
        ref={ref}
        className={cn(
          "sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
          className
        )}
        {...props}
      >
        <div className="container flex h-14 items-center justify-between px-4">
          {logo && <div className="flex items-center">{logo}</div>}
          {children && <div className="flex flex-1 items-center justify-center">{children}</div>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </header>
    );
  }
);
Header.displayName = "Header";

export { Header };
