/**
 * Client/server shared feature flags.
 * These only control UI visibility — never use as authorization.
 */
export const FEATURES = Object.freeze({
  /** Camera QR scanning deferred; keep code paths, hide entry points. */
  qrScanner: false
});
