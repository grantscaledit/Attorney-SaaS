/**
 * Full page navigation. Used for sign-out, which is a route handler that clears
 * cookies and must not go through client-side routing.
 */
export function hardNavigate(path: string): void {
  window.location.assign(path);
}
