/**
 * GET /api/logo/:registrableDomain
 *
 * Domain-keyed first-party logo cache.  Never keyed by contact name, email,
 * or phone.  Do not revive Crest PGlite/auth.
 */
import { handleVercelLogo } from "../engine/logo-cache.ts";

export const config = {
  maxDuration: 10,
};

export default handleVercelLogo;
