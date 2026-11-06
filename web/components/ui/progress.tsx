import * as React from "react";
import { cn } from "@/lib/utils";

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, max = 100, ...props }, ref) => {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100));
    return (
      <div
        ref={ref}
        className={cn(
          "relative h-2.5 w-full overflow-hidden rounded-full border border-stone-400/50 bg-gradient-to-b from-[#d4cfc7] to-[#c9c4bc] shadow-[inset_0_2px_4px_rgba(0,0,0,0.12)]",
          className
        )}
        {...props}
      >
        <div
          className="h-full rounded-full bg-gradient-to-b from-primary to-[#1e40af] shadow-[0_1px_0_rgba(255,255,255,0.25)_inset] transition-all duration-500 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    );
  }
);
Progress.displayName = "Progress";

export { Progress };
