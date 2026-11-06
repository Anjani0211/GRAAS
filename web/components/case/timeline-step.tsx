"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { motion } from "framer-motion";

interface TimelineStepProps {
  steps: { label: string; description?: string; date?: string }[];
  currentStep: number;
}

export function TimelineStep({ steps, currentStep }: TimelineStepProps) {
  return (
    <div className="relative flex flex-col gap-0">
      {steps.map((step, index) => {
        const isCompleted = index < currentStep;
        const isActive = index === currentStep;
        const isPending = index > currentStep;

        return (
          <div key={step.label} className="relative flex gap-4">
            <div className="flex flex-col items-center">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: index * 0.1 }}
                className={cn(
                  "relative z-10 flex size-8 items-center justify-center rounded-full border-2 transition-all duration-300",
                  isCompleted && "border-primary bg-primary text-white",
                  isActive && "border-primary bg-primary-soft text-primary",
                  isPending && "border-border bg-card text-muted-foreground"
                )}
              >
                {isCompleted ? (
                  <Check className="size-4" />
                ) : (
                  <span className="text-xs font-semibold">{index + 1}</span>
                )}
                {isActive && (
                  <span className="absolute inset-0 rounded-full border-2 border-primary animate-ping opacity-20" />
                )}
              </motion.div>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "w-0.5 flex-1 min-h-8 transition-colors duration-500",
                    isCompleted ? "bg-primary" : "bg-border"
                  )}
                />
              )}
            </div>
            <div className={cn("pb-8", index === steps.length - 1 && "pb-0")}>
              <p
                className={cn(
                  "text-sm font-medium leading-8",
                  isCompleted && "text-foreground",
                  isActive && "text-primary font-semibold",
                  isPending && "text-muted-foreground"
                )}
              >
                {step.label}
              </p>
              {step.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
              )}
              {step.date && (
                <p className="text-xs text-muted-foreground mt-0.5">{step.date}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
