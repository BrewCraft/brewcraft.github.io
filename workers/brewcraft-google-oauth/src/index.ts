type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number | string;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

type PendingGoogleTx = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
  expiresAt: number;
};

type StoredGoogleSession = {
  session_id: string;
  refresh_token: string;
  access_token: string;
  expires_at: number;
  created_at: number;
  provider: "google-drive";
};

type WorkerRequestBody = {
  code?: string;
  redirectUri?: string;
  state?: string;
  sessionId?: string;
  origin?: string;
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const STATE_PREFIX = "tx:";
const SESSION_PREFIX = "session:";
const STATE_TTL_SECONDS = 600;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function getAllowedOrigins(env: Env): Set<string> {
  const configured = env.ALLOWED_ORIGINS ?? "";
  return new Set(
    configured.split(",").map((value) => value.trim()).filter(Boolean),
  );
}

function getDefaultRedirectUri(env: Env): string {
  const [firstOrigin] = [...getAllowedOrigins(env)];
  return firstOrigin ? `${firstOrigin}/` : "";
}

function readAllowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  return getAllowedOrigins(env).has(origin) ? origin : null;
}

function buildCorsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

async function parseJsonRequest<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

async function requestGoogleToken(requestBody: URLSearchParams) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: requestBody.toString(),
  });

  const data = (await response.json().catch(() => ({}))) as GoogleTokenResponse;

  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Google token exchange failed");
  }

  return data;
}

function jsonResponse(payload: Record<string, unknown>, origin: string | null, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      ...buildCorsHeaders(origin),
      ...extraHeaders,
    },
  });
}

function createRandomHex(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createPkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  const bytes = new Uint8Array(digest);
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function isValidRedirectUri(value: string | null | undefined, env: Env) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return getAllowedOrigins(env).has(url.origin);
  } catch {
    return false;
  }
}

function getBearerSessionId(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() || null : null;
}

async function readSessionFromRequest(request: Request, env: Env, providedSessionId?: string | null): Promise<{ sessionId: string; record: StoredGoogleSession } | null> {
  const headerSessionId = getBearerSessionId(request);
  const sessionId = providedSessionId ?? headerSessionId;
  if (!sessionId) return null;

  const raw = await env.GOOGLE_SESSIONS.get(`${SESSION_PREFIX}${sessionId}`);
  if (!raw) return null;

  const record = JSON.parse(raw) as StoredGoogleSession;
  if (record.expires_at <= Date.now()) {
    await env.GOOGLE_SESSIONS.delete(`${SESSION_PREFIX}${sessionId}`);
    return null;
  }

  return { sessionId, record };
}

async function revokeGoogleToken(token: string) {
  await fetch(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ token }).toString(),
  }).catch(() => undefined);
}

function buildGoogleAuthUrl(env: Env, state: string, codeChallenge: string, redirectUri: string) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile https://www.googleapis.com/auth/drive.file",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = readAllowedOrigin(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: buildCorsHeaders(origin) });
    }

    if (!origin) {
      return jsonResponse({ ok: false, error: "Origin not allowed" }, null, 403);
    }

    if (request.url.endsWith("/oauth/start")) {
      const body = await parseJsonRequest<{ redirectUri?: string; origin?: string }>(request);
      const redirectUri = body?.redirectUri ?? getDefaultRedirectUri(env);

      if (!redirectUri || !isValidRedirectUri(redirectUri, env)) {
        return jsonResponse({ ok: false, error: "Invalid redirectUri" }, origin, 400);
      }

      const state = createRandomHex(16);
      const codeVerifier = createRandomHex(32);
      const codeChallenge = await createPkceChallenge(codeVerifier);
      const txRecord: PendingGoogleTx = {
        state,
        codeVerifier,
        redirectUri,
        createdAt: Date.now(),
        expiresAt: Date.now() + (STATE_TTL_SECONDS * 1000),
      };

      await env.GOOGLE_SESSIONS.put(`${STATE_PREFIX}${state}`, JSON.stringify(txRecord), { expirationTtl: STATE_TTL_SECONDS });

      return jsonResponse(
        {
          ok: true,
          authUrl: buildGoogleAuthUrl(env, state, codeChallenge, redirectUri),
          state,
          redirectUri,
        },
        origin,
        200,
      );
    }

    const body = await parseJsonRequest<WorkerRequestBody>(request);
    if (!body) {
      return jsonResponse({ ok: false, error: "Invalid JSON body" }, origin, 400);
    }

    if (request.url.endsWith("/oauth/exchange")) {
      const { code, state, redirectUri } = body;

      if (!code || !state || !redirectUri) {
        return jsonResponse({ ok: false, error: "Missing code, state or redirectUri" }, origin, 400);
      }

      if (!isValidRedirectUri(redirectUri, env)) {
        return jsonResponse({ ok: false, error: "Invalid redirectUri" }, origin, 400);
      }

      const txKey = `${STATE_PREFIX}${state}`;
      const txRaw = await env.GOOGLE_SESSIONS.get(txKey);
      if (!txRaw) {
        return jsonResponse({ ok: false, error: "Invalid OAuth state" }, origin, 400);
      }

      const tx = JSON.parse(txRaw) as PendingGoogleTx;
      if (tx.state !== state || tx.redirectUri !== redirectUri || Date.now() > tx.expiresAt) {
        await env.GOOGLE_SESSIONS.delete(txKey);
        return jsonResponse({ ok: false, error: "State validation failed" }, origin, 400);
      }

      try {
        const params = new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          code,
          redirect_uri: tx.redirectUri,
          grant_type: "authorization_code",
          code_verifier: tx.codeVerifier,
        });

        const tokenResponse = await requestGoogleToken(params);
        if (!tokenResponse.refresh_token) {
          throw new Error("Google did not return a refresh token");
        }

        const expiresIn = Number(tokenResponse.expires_in ?? 3600);
        const sessionId = createRandomHex(32);
        const sessionRecord: StoredGoogleSession = {
          session_id: sessionId,
          refresh_token: tokenResponse.refresh_token,
          access_token: tokenResponse.access_token,
          expires_at: Date.now() + (expiresIn * 1000),
          created_at: Date.now(),
          provider: "google-drive",
        };

        await env.GOOGLE_SESSIONS.put(`${SESSION_PREFIX}${sessionId}`, JSON.stringify(sessionRecord), { expirationTtl: SESSION_TTL_SECONDS });
        await env.GOOGLE_SESSIONS.delete(txKey);

        return jsonResponse({ ok: true, accessToken: tokenResponse.access_token, sessionId, expiresIn }, origin, 200);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Google token exchange failed";
        return jsonResponse({ ok: false, error: message }, origin, 400);
      }
    }

    if (request.url.endsWith("/oauth/refresh")) {
      const suppliedSessionId = body.sessionId ?? null;
      const sessionInfo = await readSessionFromRequest(request, env, suppliedSessionId);
      if (!sessionInfo) {
        return jsonResponse({ ok: false, error: "Invalid or expired session" }, origin, 401);
      }

      const { sessionId, record } = sessionInfo;

      try {
        const params = new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          refresh_token: record.refresh_token,
          grant_type: "refresh_token",
        });

        const tokenResponse = await requestGoogleToken(params);
        const nextExpiresIn = Number(tokenResponse.expires_in ?? 3600);
        const nextRefreshToken = tokenResponse.refresh_token ?? record.refresh_token;
        const updatedSession: StoredGoogleSession = {
          ...record,
          session_id: sessionId,
          access_token: tokenResponse.access_token,
          refresh_token: nextRefreshToken,
          expires_at: Date.now() + (nextExpiresIn * 1000),
          created_at: Date.now(),
          provider: "google-drive",
        };

        await env.GOOGLE_SESSIONS.put(`${SESSION_PREFIX}${sessionId}`, JSON.stringify(updatedSession), { expirationTtl: SESSION_TTL_SECONDS });

        return jsonResponse({ ok: true, accessToken: tokenResponse.access_token, sessionId, expiresIn: nextExpiresIn }, origin, 200);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Google token refresh failed";
        return jsonResponse({ ok: false, error: message }, origin, 400);
      }
    }

    if (request.url.endsWith("/oauth/disconnect")) {
      const suppliedSessionId = body.sessionId ?? null;
      const sessionInfo = await readSessionFromRequest(request, env, suppliedSessionId);
      if (!sessionInfo) {
        return jsonResponse({ ok: false, error: "Invalid or expired session" }, origin, 401);
      }

      const { sessionId, record } = sessionInfo;

      try {
        await revokeGoogleToken(record.refresh_token);
        await revokeGoogleToken(record.access_token);
        await env.GOOGLE_SESSIONS.delete(`${SESSION_PREFIX}${sessionId}`);
        return jsonResponse({ ok: true }, origin, 200);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Google disconnect failed";
        return jsonResponse({ ok: false, error: message }, origin, 400);
      }
    }

    return jsonResponse({ ok: false, error: "Not found" }, origin, 404);
  },
} satisfies ExportedHandler<Env>;

interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_SESSIONS: KVNamespace;
  ALLOWED_ORIGINS: string;
}
