/** Form state returned by server actions. Safe to import from client components. */
export type ActionState<T = undefined> =
  | { status: "idle" }
  | { status: "success"; message?: string; data: T }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

export const IDLE_STATE = { status: "idle" } as const satisfies ActionState<never>;
