'use strict';

// Managed API: Microsoft-issued access tokens for the shared dliu API, validated by an API Gateway JWT authorizer
// (signature, issuer, audience, times, route scope). This module re-checks the claims Lambda receives from that
// gateway. It never reads cookies, share-link tokens or the Authorization header itself.
const ROUTES = require('./routes.json');

const ROLE = 'api.access';

/**
 * API Gateway HTTP APIs pass array claims to Lambda as a bracketed, space-separated string that is not JSON:
 * Microsoft's "roles": ["api.access", "other"] arrives as "[api.access other]". Entra role values cannot
 * contain spaces, so each role is matched exactly. Real arrays, JSON arrays and a bare single value are also
 * accepted; anything else returns null so the request is denied.
 */
function parseRoles(roles) {
  if (typeof roles === 'string') {
    if (/^\[\s*"/.test(roles)) {
      try { roles = JSON.parse(roles); } catch { return null; }
    } else if (roles.startsWith('[') && roles.endsWith(']')) {
      const inner = roles.slice(1, -1);
      if (!inner) return [];
      roles = inner.split(' ');
      if (roles.some((role) => !role || /["\s]/.test(role))) return null;
    } else if (/^[^\s"[\]]+$/.test(roles)) {
      roles = [roles];
    } else {
      return null;
    }
  }
  return Array.isArray(roles) && roles.every((role) => typeof role === 'string') ? roles : null;
}

// A request came through the managed API (not CloudFront and the function URL, whose routeKey is $default).
// Only AWS sets requestContext, so viewers can't make a website request look managed or the other way round.
function isManaged(event) {
  const context = event && event.requestContext;
  return Boolean(context && ((context.authorizer && context.authorizer.jwt) ||
    (context.apiId && context.routeKey && context.routeKey !== '$default')));
}

function routeFor(event) {
  const key = event.requestContext && event.requestContext.routeKey;
  return typeof key === 'string' && Object.hasOwn(ROUTES, key) ? ROUTES[key] : null;
}

function authorize(event, scope) {
  const context = event.requestContext;
  const jwt = context && context.authorizer && context.authorizer.jwt;
  const claims = jwt && jwt.claims;
  const tenant = process.env.API_TENANT_ID;
  const audience = process.env.API_AUDIENCE;
  const client = process.env.API_CLIENT_ID;
  // Only API Gateway supplies this context; viewer headers and cookies are not evidence of JWT validation.
  if (!process.env.API_GATEWAY_ID || !context || context.apiId !== process.env.API_GATEWAY_ID ||
      !tenant || !audience || !client || !claims ||
      claims.ver !== '2.0' || claims.iss !== `https://login.microsoftonline.com/${tenant}/v2.0` ||
      claims.tid !== tenant || claims.aud !== audience ||
      typeof claims.oid !== 'string' || !claims.oid || typeof claims.sub !== 'string' || !claims.sub) {
    return { status: 401, error: 'Microsoft access token required' };
  }
  // Access comes from the explicitly assigned User-only app role and the route scope. Mutable claims such as
  // preferred_username or email are never used for authorization (Microsoft's access-token claims guidance);
  // the website's own @dliu.com sign-in check is separate and unchanged.
  const roles = parseRoles(claims.roles);
  if (claims.azp !== client || !roles || !roles.includes(ROLE) ||
      typeof scope !== 'string' || !Array.isArray(jwt.scopes) || !jwt.scopes.includes(scope)) {
    return { status: 403, error: 'Travel plan API permission required' };
  }
  // Display only (the "updated by" label): identity is always the immutable oid.
  const display = [claims.name, claims.preferred_username].find((value) => typeof value === 'string' && value.trim());
  return { user: claims.oid, name: display ? display.trim().slice(0, 100) : claims.oid };
}

module.exports = { ROLE, ROUTES, authorize, isManaged, parseRoles, routeFor };
