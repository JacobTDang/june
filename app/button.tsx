"use client";

import { LoaderCircle } from "lucide-react";
import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";

type ButtonProps = HTMLMotionProps<"button"> & {
  /** Show a spinner and disable while an action is in flight. */
  pending?: boolean;
};

const SPRING = { type: "spring", stiffness: 520, damping: 30, mass: 0.6 } as const;

/**
 * A button with springy press/hover feedback and an inline pending spinner, so
 * a tap registers instantly even while a server action round-trips. Honors
 * prefers-reduced-motion. Pass the usual `.btn` classes via `className`.
 */
export function Button({
  pending,
  disabled,
  children,
  className = "btn",
  ...rest
}: ButtonProps) {
  const reduce = useReducedMotion();
  const still = reduce || disabled || pending;
  return (
    <motion.button
      className={className}
      disabled={disabled || pending}
      whileTap={still ? undefined : { scale: 0.96 }}
      whileHover={still ? undefined : { y: -1 }}
      transition={SPRING}
      {...rest}
    >
      {pending ? <LoaderCircle className="spin" size={17} aria-label="Working…" /> : children}
    </motion.button>
  );
}
