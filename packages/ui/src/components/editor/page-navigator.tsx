import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export interface PageNavigatorProps extends React.HTMLAttributes<HTMLDivElement> {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  showInput?: boolean;
}

const PageNavigator = React.forwardRef<HTMLDivElement, PageNavigatorProps>(
  (
    {
      className,
      currentPage,
      totalPages,
      onPageChange,
      showInput = true,
      ...props
    },
    ref
  ) => {
    const [inputValue, setInputValue] = React.useState(currentPage.toString());

    React.useEffect(() => {
      setInputValue(currentPage.toString());
    }, [currentPage]);

    const handlePrevious = () => {
      if (currentPage > 1) {
        onPageChange(currentPage - 1);
      }
    };

    const handleNext = () => {
      if (currentPage < totalPages) {
        onPageChange(currentPage + 1);
      }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(e.target.value);
    };

    const handleInputBlur = () => {
      const page = parseInt(inputValue, 10);
      if (!isNaN(page) && page >= 1 && page <= totalPages) {
        onPageChange(page);
      } else {
        setInputValue(currentPage.toString());
      }
    };

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        handleInputBlur();
      }
    };

    return (
      <div
        ref={ref}
        className={cn("flex items-center gap-2", className)}
        {...props}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={handlePrevious}
          disabled={currentPage <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {showInput ? (
          <div className="flex items-center gap-1">
            <Input
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              onBlur={handleInputBlur}
              onKeyDown={handleInputKeyDown}
              className="h-8 w-12 text-center"
              aria-label="Current page"
            />
            <span className="text-sm text-muted-foreground">/ {totalPages}</span>
          </div>
        ) : (
          <span className="text-sm">
            {currentPage} / {totalPages}
          </span>
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={handleNext}
          disabled={currentPage >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    );
  }
);
PageNavigator.displayName = "PageNavigator";

export { PageNavigator };
