/**
 * Whether a planner space is drawn as the Grand Hall's real-time room. Uses
 * the same test as the planner's room variant, so the model, its controls and
 * its captions always agree about which room they serve.
 */
export function isModelledGrandHall(space: { readonly name: string } | null | undefined): boolean {
  return space?.name === "Grand Hall";
}
