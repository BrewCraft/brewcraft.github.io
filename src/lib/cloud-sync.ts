import { readSettings } from "./settings";
import { restoreBackup } from "./backup";

export type CloudProvider = "dropbox" | "google-drive" | "onedrive";

export type CloudSyncConfig = {
  provider: CloudProvider;
  enabled: boolean;
  token: string;
  folder: string;
  fileName: string;
  lastSyncAt: string | null;
  lastSyncStatus: string;
};

export type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
};

type ProviderSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  accountName?: string;
  accountEmail?: string;
  syncFileId?: string;
  syncFileName?: string;
};

const LEGACY_CLOUD_SYNC_KEY = "brewfather-cloud-sync";
const CLOUD_SYNC_KEY_PREFIX = "brewfather-cloud-sync-";
const SESSION_PREFIX = "brewfather-cloud-session-";
const PKCE_PREFIX = "brewfather-cloud-pkce-";

export const defaultCloudSyncConfig: CloudSyncConfig = {
  provider: "dropbox",
  enabled: false,
  token: "",
  folder: "BrewCraft",
  fileName: "brewcraft-sync.json",
  lastSyncAt: null,
  lastSyncStatus: "Nunca sincronizado",
};

export const cloudProviderLabels: Record<CloudProvider, string> = {
  dropbox: "Dropbox",
  "google-drive": "Google Drive",
  onedrive: "OneDrive",
};

export const supportedCloudProviders: CloudProvider[] = ["dropbox", "google-drive", "onedrive"];

function normalizeCloudProvider(provider?: string | null, fallback: CloudProvider = "dropbox"): CloudProvider {
  if (provider === "dropbox" || provider === "google-drive" || provider === "onedrive") {
    return provider;
  }
  return fallback;
}

const readAllLocalData = () => {
  const keyMap = {
    receitas: "brewfather-recipes",
    lotes: "brewfather-batches",
    "inventário": "brewfather-inventory",
    "perfil-equipamento": "brewfather-profiles-equipamento",
    "perfil-mostura": "brewfather-profiles-mostura",
    "perfil-fermentacao": "brewfather-profiles-fermentacao",
    "perfil-agua": "brewfather-profiles-agua",
    "perfil-estilos": "brewfather-profiles-estilos",
  } as const;

  const result: Record<string, unknown[]> = {};
  for (const [name, storageKey] of Object.entries(keyMap)) {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      result[name] = Array.isArray(value) ? value : [];
    } catch {
      result[name] = [];
    }
  }
  return result;
};

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function getSessionKey(provider: CloudProvider) {
  return `${SESSION_PREFIX}${provider}`;
}

function getProviderConfigKey(provider: CloudProvider) {
  return `${CLOUD_SYNC_KEY_PREFIX}${provider}`;
}

function getPkceKey(provider: CloudProvider) {
  return `${PKCE_PREFIX}${provider}`;
}

function readProviderSession(provider: CloudProvider): ProviderSession | null {
  const raw = sessionStorage.getItem(getSessionKey(provider));
  const parsed = safeJsonParse(raw, null) as ProviderSession | null;
  if (!parsed || typeof parsed.accessToken !== "string") return null;
  return parsed;
}

function writeProviderSession(provider: CloudProvider, session: ProviderSession | null) {
  const key = getSessionKey(provider);
  if (!session) {
    sessionStorage.removeItem(key);
    return;
  }
  sessionStorage.setItem(key, JSON.stringify(session));
}

function readPkceState(provider: CloudProvider) {
  return safeJsonParse(sessionStorage.getItem(getPkceKey(provider)), null) as { verifier: string; state: string } | null;
}

function writePkceState(provider: CloudProvider, value: { verifier: string; state: string } | null) {
  const key = getPkceKey(provider);
  if (!value) {
    sessionStorage.removeItem(key);
    return;
  }
  sessionStorage.setItem(key, JSON.stringify(value));
}

function base64UrlEncode(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Base64Url(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return base64UrlEncode(digest);
}

function randomUrlSafeToken(length = 32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function getRedirectUri() {
  if (typeof window === "undefined") return "http://localhost:8080";
  const origin = window.location.origin;
  return origin && origin !== "null" ? origin : "http://localhost:8080";
}

function getProviderEnvName(provider: CloudProvider) {
  return provider === "dropbox" ? "DROPBOX" : provider === "google-drive" ? "GOOGLE" : "ONEDRIVE";
}

function getProviderClientId(provider: CloudProvider) {
  const envKey = `VITE_${getProviderEnvName(provider)}_CLIENT_ID`;
  return (import.meta.env[envKey] ?? "").trim();
}

function getProviderAccountName(provider: CloudProvider) {
  return readProviderSession(provider)?.accountName ?? null;
}

function getProviderLastSyncMessage(provider: CloudProvider) {
  const config = readCloudSyncConfig(provider);
  return config.lastSyncStatus || defaultCloudSyncConfig.lastSyncStatus;
}

function getProviderLastSyncAt(provider: CloudProvider) {
  return readCloudSyncConfig(provider).lastSyncAt;
}

export function googleDriveIsConnected() {
  return Boolean(readProviderSession("google-drive")?.accessToken);
}

export function getGoogleDriveProfileName() {
  return getProviderAccountName("google-drive");
}

function readLegacyCloudSyncConfig(): Partial<CloudSyncConfig> | null {
  try {
    const raw = safeJsonParse(localStorage.getItem(LEGACY_CLOUD_SYNC_KEY), null) as Partial<CloudSyncConfig> | null;
    if (!raw || typeof raw !== "object") return null;
    return raw;
  } catch {
    return null;
  }
}

export function readCloudSyncConfig(provider?: CloudProvider): CloudSyncConfig {
  const targetProvider = normalizeCloudProvider(provider ?? readLegacyCloudSyncConfig()?.provider ?? defaultCloudSyncConfig.provider);

  try {
    const raw = safeJsonParse(localStorage.getItem(getProviderConfigKey(targetProvider)), null) as Partial<CloudSyncConfig> | null;
    const base = readLegacyCloudSyncConfig();
    const legacyProvider = normalizeCloudProvider(base?.provider ?? defaultCloudSyncConfig.provider); 
    const migrated = !raw && legacyProvider === targetProvider ? base : raw;

    const sessionToken = readProviderSession(targetProvider)?.accessToken ?? "";
    const fallbackToken = typeof migrated?.token === "string" ? migrated.token : "";
    const token = sessionToken || fallbackToken;

    const config: CloudSyncConfig = {
      ...defaultCloudSyncConfig,
      ...(migrated ?? {}),
      provider: targetProvider,
      enabled: Boolean(migrated?.enabled),
      token,
      folder: typeof migrated?.folder === "string" && migrated.folder.trim() ? migrated.folder : defaultCloudSyncConfig.folder,
      fileName: typeof migrated?.fileName === "string" && migrated.fileName.trim() ? migrated.fileName : defaultCloudSyncConfig.fileName,
      lastSyncAt: typeof migrated?.lastSyncAt === "string" ? migrated.lastSyncAt : null,
      lastSyncStatus: typeof migrated?.lastSyncStatus === "string" ? migrated.lastSyncStatus : defaultCloudSyncConfig.lastSyncStatus,
    };

    if (!raw && legacyProvider === targetProvider && typeof base !== "undefined" && base !== null) {
      localStorage.setItem(getProviderConfigKey(targetProvider), JSON.stringify(config));
    }

    return config;
  } catch {
    return { ...defaultCloudSyncConfig, provider: targetProvider };
  }
}

export function saveCloudSyncConfig(patch: Partial<CloudSyncConfig>) {
  const provider = normalizeCloudProvider(patch.provider ?? readCloudSyncConfig().provider ?? defaultCloudSyncConfig.provider);
  const current = readCloudSyncConfig(provider);
  const next = { ...current, ...patch, provider };

  const persisted: CloudSyncConfig = {
    provider,
    enabled: Boolean(next.enabled),
    folder: next.folder.trim() || defaultCloudSyncConfig.folder,
    fileName: next.fileName.trim() || defaultCloudSyncConfig.fileName,
    lastSyncAt: next.lastSyncAt,
    lastSyncStatus: next.lastSyncStatus || defaultCloudSyncConfig.lastSyncStatus,
    token: next.token || "",
  };

  const session = readProviderSession(provider);
  if (next.token && session) {
    writeProviderSession(provider, { ...session, accessToken: next.token });
  } else if (!next.token) {
    writeProviderSession(provider, null);
  }

  localStorage.setItem(getProviderConfigKey(provider), JSON.stringify(persisted));
  if (provider === "dropbox") {
    const legacy = readLegacyCloudSyncConfig();
    if (!legacy || legacy.provider !== provider) {
      localStorage.removeItem(LEGACY_CLOUD_SYNC_KEY);
    }
  }
  return readCloudSyncConfig(provider);
}

export function getCloudOAuthUrl(provider: CloudProvider, redirectUri: string = getRedirectUri()) {
  const clientId = getProviderClientId(provider);
  if (!clientId) return null;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: provider === "dropbox"
      ? "files.content.write files.content.read account_info.read"
      : provider === "google-drive"
        ? "openid email profile https://www.googleapis.com/auth/drive.file"
        : "Files.ReadWrite offline_access User.Read",
    state: randomUrlSafeToken(32),
  });

  if (provider === "dropbox") {
    params.set("code_challenge_method", "S256");
    params.set("code_challenge", "");
    return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
  }

  if (provider === "google-drive") {
    params.set("access_type", "offline");
    params.set("include_granted_scopes", "true");
    params.set("prompt", "consent");
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  params.set("response_mode", "query");
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}

export function openCloudAuth(provider: CloudProvider) {
  const url = getCloudOAuthUrl(provider);
  if (!url) {
    return false;
  }
  window.open(url, "brewcraft-cloud-auth", "width=520,height=700,noopener,noreferrer");
  return true;
}

export function captureCloudTokenFromUrl(provider: CloudProvider) {
  const raw = (window.location.hash || window.location.search || "").replace(/^#?/, "");
  if (!raw) return null;
  const params = new URLSearchParams(raw.includes("=") ? raw : `?${raw}`);
  const accessToken = params.get("access_token") || params.get("token");
  if (!accessToken) return null;
  const config = readCloudSyncConfig(provider);
  return saveCloudSyncConfig({
    ...config,
    provider,
    enabled: true,
    token: accessToken,
    lastSyncStatus: `Conectado ao ${cloudProviderLabels[provider]}`,
  });
}

export function makeCloudPayload() {
  const now = new Date().toISOString();
  const data = readAllLocalData();
  const settings = readSettings();
  const content = stableStringify({ data, settings });
  return {
    app: "brewcraft-web",
    version: 2,
    exportedAt: now,
    updatedAt: now,
    revision: fnv1aHash(content),
    data,
    settings,
  };
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function fnv1aHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function pickUpdatedAt(value: Record<string, unknown> | null | undefined) {
  if (!value || typeof value !== "object") return null;
  const candidate = value.updatedAt ?? value.exportedAt ?? value.modifiedAt;
  if (typeof candidate !== "string") return null;
  const parsed = new Date(candidate).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function pickRevision(value: Record<string, unknown> | null | undefined) {
  if (!value || typeof value !== "object") return null;
  const revision = value.revision ?? value.version ?? null;
  return typeof revision === "string" || typeof revision === "number" ? String(revision) : null;
}

const providerRequestMeta = {
  dropbox: {
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    userInfoUrl: "https://api.dropboxapi.com/2/users/get_current_account",
  },
  "google-drive": {
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
  },
  onedrive: {
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    userInfoUrl: "https://graph.microsoft.com/v1.0/me",
  },
} as const;

async function exchangeCodeForToken(provider: CloudProvider, code: string, verifier: string, redirectUri: string): Promise<ProviderSession> {
  const clientId = getProviderClientId(provider);
  if (!clientId) {
    throw new Error(`Falta VITE_${getProviderEnvName(provider)}_CLIENT_ID no ambiente do frontend.`);
  }

  const params = new URLSearchParams({
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });

  const response = await fetch(providerRequestMeta[provider].tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number | string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Não foi possível trocar o código de autorização por um token válido.");
  }

  const nextExpiresAt = Date.now() + (Number(data.expires_in ?? 3600) * 1000);
  const session = readProviderSession(provider);
  const connectedSession: ProviderSession = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? session?.refreshToken,
    expiresAt: nextExpiresAt,
    accountName: session?.accountName,
  };

  const profileName = await fetchProviderAccountName(provider, connectedSession.accessToken);
  if (profileName) {
    connectedSession.accountName = profileName;
  }

  writeProviderSession(provider, connectedSession);
  saveCloudSyncConfig({
    provider,
    enabled: true,
    token: connectedSession.accessToken,
    lastSyncStatus: `Conectado ao ${cloudProviderLabels[provider]}`,
  });

  return connectedSession;
}

async function fetchProviderAccountName(provider: CloudProvider, accessToken: string) {
  if (provider === "dropbox") {
    const response = await fetch(providerRequestMeta.dropbox.userInfoUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const result = await response.json().catch(() => ({})) as { name?: { familiar_name?: string; display_name?: string }; email?: string; };
    if (!response.ok) return null;
    return result.name?.display_name || result.name?.familiar_name || result.email || "Conta Dropbox";
  }

  if (provider === "google-drive") {
    const response = await fetch(providerRequestMeta["google-drive"].userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const result = await response.json().catch(() => ({})) as { name?: string; email?: string };
    return result.name || result.email || "Conta Google";
  }

  const response = await fetch(providerRequestMeta.onedrive.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const result = await response.json().catch(() => ({})) as { displayName?: string; userPrincipalName?: string };
  return result.displayName || result.userPrincipalName || "Conta OneDrive";
}

async function refreshProviderToken(provider: CloudProvider, refreshToken: string): Promise<ProviderSession> {
  const clientId = getProviderClientId(provider);
  if (!clientId) {
    throw new Error(`Falta VITE_${getProviderEnvName(provider)}_CLIENT_ID no ambiente do frontend.`);
  }

  const response = await fetch(providerRequestMeta[provider].tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number | string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Não foi possível renovar o token do ${cloudProviderLabels[provider]}.`);
  }

  const session = readProviderSession(provider) ?? { accessToken: "", expiresAt: 0 };
  const refreshed = {
    ...session,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + (Number(data.expires_in ?? 3600) * 1000),
  };

  if (!refreshed.accountName) {
    const profileName = await fetchProviderAccountName(provider, refreshed.accessToken);
    if (profileName) {
      refreshed.accountName = profileName;
    }
  }

  writeProviderSession(provider, refreshed);
  saveCloudSyncConfig({ provider, enabled: true, token: refreshed.accessToken, lastSyncStatus: `Token renovado do ${cloudProviderLabels[provider]}` });
  return refreshed;
}

async function ensureAccessToken(provider: CloudProvider) {
  const session = readProviderSession(provider);
  if (!session?.accessToken) {
    throw new Error(`Você precisa conectar sua conta do ${cloudProviderLabels[provider]} antes de sincronizar.`);
  }

  if (Date.now() >= session.expiresAt - 60_000) {
    if (!session.refreshToken) {
      throw new Error(`A sessão do ${cloudProviderLabels[provider]} expirou e não há um refresh token disponível.`);
    }
    const refreshedSession = await refreshProviderToken(provider, session.refreshToken);
    return refreshedSession.accessToken;
  }

  return session.accessToken;
}

function buildAuthUrlForProvider(provider: CloudProvider, challenge: string, state: string, redirectUri: string) {
  const clientId = getProviderClientId(provider);
  if (!clientId) {
    throw new Error(`Falta VITE_${getProviderEnvName(provider)}_CLIENT_ID no ambiente do frontend.`);
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  if (provider === "dropbox") {
    params.set("scope", "files.content.write files.content.read account_info.read");
    return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
  }

  if (provider === "google-drive") {
    params.set("scope", "openid email profile https://www.googleapis.com/auth/drive.file");
    params.set("access_type", "offline");
    params.set("include_granted_scopes", "true");
    params.set("prompt", "consent");
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  params.set("scope", "Files.ReadWrite offline_access User.Read");
  params.set("response_mode", "query");
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}

async function startProviderAuth(provider: CloudProvider) {
  const redirectUri = getRedirectUri();
  const verifier = randomUrlSafeToken(64);
  const challenge = await sha256Base64Url(verifier);
  const state = randomUrlSafeToken(32);
  const authUrl = buildAuthUrlForProvider(provider, challenge, state, redirectUri);

  writePkceState(provider, { verifier, state });

  const popup = window.open(authUrl, "brewcraft-cloud-auth", "width=520,height=700");
  if (!popup) {
    throw new Error("O navegador bloqueou a janela de autenticação. Permita pop-ups para continuar.");
  }

  const timeoutMs = 180000;
  const startedAt = Date.now();

  return await new Promise<ProviderSession>((resolve, reject) => {
    const cleanup = () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timer);
      popup.close();
      writePkceState(provider, null);
    };

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Tempo limite da autenticação excedido."));
    }, timeoutMs - (Date.now() - startedAt));

    const intervalId = window.setInterval(async () => {
      try {
        if (popup.closed) {
          cleanup();
          reject(new Error("A janela de autenticação foi fechada antes da conclusão."));
          return;
        }

        const popupUrl = popup.location.href;
        const targetUrl = new URL(popupUrl);
        if (targetUrl.origin !== window.location.origin) {
          return;
        }

        const code = targetUrl.searchParams.get("code");
        const returnedState = targetUrl.searchParams.get("state");
        const error = targetUrl.searchParams.get("error");
        const errorDescription = targetUrl.searchParams.get("error_description");

        if (error) {
          cleanup();
          reject(new Error(errorDescription || error || "A autenticação foi cancelada pelo provedor."));
          return;
        }

        const pkceInfo = readPkceState(provider);
        if (!code || !returnedState || !pkceInfo || returnedState !== pkceInfo.state) {
          return;
        }

        cleanup();
        try {
          const session = await exchangeCodeForToken(provider, code, pkceInfo.verifier, redirectUri);
          resolve(session);
        } catch (error) {
          reject(error instanceof Error ? error : new Error("Não foi possível completar a autenticação."));
        }
      } catch {
        // popup is still cross-origin, so ignore it until it returns to the app origin.
      }
    }, 350);
  });
}

export async function connectProvider(provider: CloudProvider) {
  const existing = readProviderSession(provider);
  if (existing && existing.accessToken && Date.now() < existing.expiresAt - 60_000) {
    return existing;
  }

  const session = await startProviderAuth(provider);
  saveCloudSyncConfig({
    provider,
    enabled: true,
    token: session.accessToken,
    lastSyncStatus: `Conectado ao ${cloudProviderLabels[provider]}`,
  });
  return session;
}

export async function disconnectProvider(provider: CloudProvider) {
  const session = readProviderSession(provider);
  if (session?.accessToken) {
    try {
      if (provider === "google-drive") {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(session.accessToken)}`, { method: "POST" });
      }
    } catch {
      // ignore revocation errors; a local disconnect is still allowed.
    }
  }

  writeProviderSession(provider, null);
  saveCloudSyncConfig({
    provider,
    enabled: false,
    token: "",
    lastSyncStatus: `Desconectado do ${cloudProviderLabels[provider]}`,
  });
}

export async function connectGoogleDrive() {
  return connectProvider("google-drive");
}

export async function disconnectGoogleDrive() {
  return disconnectProvider("google-drive");
}

async function findGoogleDriveFile(config: CloudSyncConfig) {
  const token = await ensureAccessToken("google-drive");
  const folderName = config.folder.trim();
  const fileName = config.fileName.trim() || defaultCloudSyncConfig.fileName;
  const folderQuery = folderName
    ? `name = '${folderName.replace(/'/g, "\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    : "";

  let parentId: string | null = null;
  if (folderName) {
    const folderResponse = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(folderQuery)}&fields=files(id,name)&pageSize=10`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (folderResponse.ok) {
      const folderData = await folderResponse.json().catch(() => ({})) as { files?: Array<{ id: string }> };
      parentId = folderData.files?.[0]?.id ?? null;
    }
  }

  const query = parentId
    ? `'${parentId}' in parents and name = '${fileName.replace(/'/g, "\'")}' and trashed = false`
    : `name = '${fileName.replace(/'/g, "\'")}' and trashed = false`;

  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&pageSize=10`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Não foi possível localizar o arquivo do Google Drive: ${response.status} ${text.slice(0, 200)}`);
  }
  const data = await response.json().catch(() => ({})) as { files?: GoogleDriveFile[] };
  return data.files?.[0] ?? null;
}

async function ensureGoogleDriveFolder(folderName: string, token: string) {
  if (!folderName.trim()) return null;
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name = '${folderName.replace(/'/g, "\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)}&fields=files(id,name)&pageSize=10`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Não foi possível localizar a pasta do Google Drive: ${response.status}`);
  }

  const data = await response.json().catch(() => ({})) as { files?: Array<{ id: string }> };
  if (data.files?.[0]?.id) return data.files[0].id;

  const createResponse = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder" }),
  });

  const createData = await createResponse.json().catch(() => ({})) as { id?: string };
  if (!createResponse.ok || !createData.id) {
    throw new Error("Não foi possível criar a pasta do Google Drive para a sincronização.");
  }
  return createData.id;
}

function normalizeRemotePathSegment(value: string) {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

export function getRemotePath(config: CloudSyncConfig) {
  const folder = normalizeRemotePathSegment(config.folder);
  const fileName = normalizeRemotePathSegment(config.fileName || defaultCloudSyncConfig.fileName);
  const segments = [folder, fileName].filter(Boolean);
  return `/${segments.join("/")}`;
}

async function ensureDropboxFolder(folderPath: string, token: string) {
  const normalized = normalizeRemotePathSegment(folderPath);
  if (!normalized) return;

  const response = await fetch("https://api.dropboxapi.com/2/files/create_folder_v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: `/${normalized}` }),
  });

  if (response.status === 409) return;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Não foi possível criar a pasta do Dropbox: ${response.status} ${text.slice(0, 200)}`);
  }
}

async function ensureOneDriveFolder(folderName: string, token: string) {
  if (!folderName.trim()) return;

  const response = await fetch("https://graph.microsoft.com/v1.0/me/drive/root/children", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Não foi possível acessar a pasta raiz do OneDrive: ${text.slice(0, 200)}`);
  }

  const data = await response.json().catch(() => ({})) as { value?: Array<{ name?: string; id?: string; folder?: Record<string, unknown> }> };
  const folder = data.value?.find((entry) => entry.name === folderName && Boolean(entry.folder));
  if (folder?.id) return folder.id;

  const createResponse = await fetch("https://graph.microsoft.com/v1.0/me/drive/root/children", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: folderName, folder: {} }),
  });

  if (!createResponse.ok) {
    const text = await createResponse.text();
    throw new Error(`Não foi possível criar a pasta do OneDrive: ${text.slice(0, 200)}`);
  }
}

async function readRemoteFile(config: CloudSyncConfig): Promise<string | null> {
  if (!config.enabled) return null;
  try {
    const token = await ensureAccessToken(config.provider);

    if (config.provider === "dropbox") {
      const response = await fetch("https://content.dropboxapi.com/2/files/download", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": JSON.stringify({ path: getRemotePath(config) }),
        },
      });
      if (response.status === 404 || response.status === 409) return null;
      return await response.text();
    }

    if (config.provider === "google-drive") {
      const existing = await findGoogleDriveFile(config);
      if (!existing) return null;
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${existing.id}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 404) return null;
      return await response.text();
    }

    const encodedPath = getRemotePath(config).split("/").map((segment) => encodeURIComponent(segment)).join("/");
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/content`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 404) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function writeRemoteFile(config: CloudSyncConfig, content: string) {
  if (!config.enabled) {
    throw new Error("Ative a sincronização para continuar.");
  }

  const token = await ensureAccessToken(config.provider);

  if (config.provider === "dropbox") {
    if (!content || !content.trim()) {
      throw new Error("Não há conteúdo válido para enviar ao Dropbox.");
    }
    await ensureDropboxFolder(config.folder, token);
    const response = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          path: getRemotePath(config),
          mode: { ".tag": "overwrite" },
          autorename: false,
          mute: true,
        }),
      },
      body: content,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Erro ao gravar no Dropbox: ${response.status} ${text.slice(0, 200)}`);
    }
    return;
  }

  if (config.provider === "google-drive") {
    const folderId = await ensureGoogleDriveFolder(config.folder, token);
    const existing = await findGoogleDriveFile(config);

    if (existing) {
      const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: content,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Erro ao gravar no Google Drive: ${response.status} ${text.slice(0, 200)}`);
      }
      return;
    }

    const metadata = {
      name: config.fileName.trim() || defaultCloudSyncConfig.fileName,
      mimeType: "application/json",
      description: "BrewCraft backup",
      ...(folderId ? { parents: [folderId] } : {}),
    };

    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", new Blob([content], { type: "application/json" }));

    const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Erro ao gravar no Google Drive: ${response.status} ${text.slice(0, 200)}`);
    }
    return;
  }

  await ensureOneDriveFolder(config.folder, token);
  const encodedPath = getRemotePath(config).split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/content`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: content,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Erro ao gravar no OneDrive: ${response.status} ${text.slice(0, 200)}`);
  }
}

export async function syncCloudData(provider: CloudProvider = readCloudSyncConfig().provider): Promise<{ action: "uploaded" | "downloaded" | "skipped"; message: string }> {
  const config = readCloudSyncConfig(provider);
  if (!config.enabled) {
    throw new Error("Ative a sincronização antes de enviar ou baixar os dados da nuvem.");
  }

  const localPayload = makeCloudPayload();
  const localPayloadJson = JSON.stringify(localPayload, null, 2);
  if (!localPayloadJson || !localPayloadJson.trim()) {
    throw new Error("Não há dados locais válidos para sincronização.");
  }

  const remoteText = await readRemoteFile(config);

  if (remoteText) {
    try {
      const remotePayload = JSON.parse(remoteText) as Record<string, unknown>;
      const remoteUpdatedAt = pickUpdatedAt(remotePayload);
      const localUpdatedAt = pickUpdatedAt(localPayload);
      const remoteRevision = pickRevision(remotePayload);
      const localRevision = pickRevision(localPayload);
      const remoteSignature = fnv1aHash(stableStringify({ data: remotePayload.data ?? {}, settings: remotePayload.settings ?? {} }));
      const localSignature = fnv1aHash(stableStringify({ data: localPayload.data, settings: localPayload.settings }));

      if (remoteUpdatedAt && localUpdatedAt && remoteUpdatedAt > localUpdatedAt) {
        restoreBackup(remotePayload);
        saveCloudSyncConfig({ provider: config.provider, lastSyncAt: new Date().toISOString(), lastSyncStatus: "Dados baixados da nuvem" });
        return { action: "downloaded", message: "Dados recebidos da nuvem e restaurados localmente." };
      }

      if (remoteUpdatedAt && localUpdatedAt && remoteUpdatedAt < localUpdatedAt) {
        await writeRemoteFile(config, localPayloadJson);
        saveCloudSyncConfig({ provider: config.provider, lastSyncAt: new Date().toISOString(), lastSyncStatus: "Dados enviados para a nuvem" });
        return { action: "uploaded", message: "Dados locais enviados para a nuvem." };
      }

      if (remoteUpdatedAt && localUpdatedAt && remoteUpdatedAt === localUpdatedAt && remoteSignature !== localSignature) {
        localStorage.setItem("brewfather-cloud-conflict", JSON.stringify({ provider: config.provider, remotePayload, localPayload, createdAt: new Date().toISOString() }));
        saveCloudSyncConfig({ provider: config.provider, lastSyncAt: new Date().toISOString(), lastSyncStatus: "Conflito detectado entre alterações locais e remotas" });
        return { action: "skipped", message: "Conflito detectado: a versão local e a remota diferiram. Nenhuma alteração foi sobrescrita." };
      }

      if (remoteRevision && localRevision && remoteRevision === localRevision && remoteUpdatedAt === localUpdatedAt) {
        saveCloudSyncConfig({ provider: config.provider, lastSyncAt: new Date().toISOString(), lastSyncStatus: "Dados já sincronizados" });
        return { action: "skipped", message: "Os dados já estavam sincronizados." };
      }
    } catch {
      // If the remote file is invalid, we upload the local data to replace it.
    }
  }

  await writeRemoteFile(config, localPayloadJson);
  saveCloudSyncConfig({ provider: config.provider, lastSyncAt: new Date().toISOString(), lastSyncStatus: "Dados enviados para a nuvem" });
  return { action: "uploaded", message: "Dados enviados para a nuvem." };
}

export function getSyncFilePath(config: CloudSyncConfig) {
  return getRemotePath(config);
}

export async function listGoogleDriveFiles(): Promise<GoogleDriveFile[]> {
  const token = await ensureAccessToken("google-drive");
  const response = await fetch("https://www.googleapis.com/drive/v3/files?q=mimeType%20%3D%20%27application%2Fjson%27%20and%20trashed%20%3D%20false&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,modifiedTime,webViewLink)&pageSize=50", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Não foi possível listar arquivos do Google Drive: ${response.status} ${text.slice(0, 200)}`);
  }
  const data = await response.json().catch(() => ({})) as { files?: GoogleDriveFile[] };
  return data.files ?? [];
}

export async function loadGoogleDriveFile(fileId: string): Promise<string> {
  const token = await ensureAccessToken("google-drive");
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Arquivo não encontrado ou sem acesso: ${response.status} ${text.slice(0, 200)}`);
  }
  const text = await response.text();
  try {
    JSON.parse(text);
    return text;
  } catch {
    throw new Error("O arquivo selecionado não é um JSON válido do BrewCraft.");
  }
}

export async function createGoogleDriveFile(fileName: string, content: string): Promise<GoogleDriveFile> {
  const token = await ensureAccessToken("google-drive");
  const folderId = await ensureGoogleDriveFolder(readCloudSyncConfig("google-drive").folder, token);
  const metadata = {
    name: fileName || defaultCloudSyncConfig.fileName,
    mimeType: "application/json",
    description: "Arquivo de backup do BrewCraft",
    ...(folderId ? { parents: [folderId] } : {}),
  };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", new Blob([content], { type: "application/json" }));

  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Não foi possível criar o arquivo no Google Drive: ${response.status} ${text.slice(0, 200)}`);
  }
  const file = await response.json().catch(() => ({})) as GoogleDriveFile;
  return file;
}

export async function saveGoogleDriveFile(fileId: string, content: string): Promise<GoogleDriveFile> {
  const token = await ensureAccessToken("google-drive");
  const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: content,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Não foi possível salvar o arquivo no Google Drive: ${response.status} ${text.slice(0, 200)}`);
  }
  return await response.json().catch(() => ({})) as GoogleDriveFile;
}

export function getGooglePickerApiKey() {
  return (import.meta.env.VITE_GOOGLE_PICKER_API_KEY ?? "").trim();
}

export function getGooglePickerAppId() {
  return (import.meta.env.VITE_GOOGLE_APP_ID ?? "").trim();
}

export async function openGoogleDrivePicker(): Promise<GoogleDriveFile | null> {
  const files = await listGoogleDriveFiles();
  return files[0] ?? null;
}

export function getProviderConnectionStatus(provider: CloudProvider) {
  const session = readProviderSession(provider);
  const config = readCloudSyncConfig(provider);
  const hasToken = Boolean(session?.accessToken || config.token);
  const connected = hasToken && (config.enabled || Boolean(session?.accessToken));
  const accountName = session?.accountName ?? (config.enabled && hasToken ? "Conta conectada" : null);

  return {
    connected,
    accountName,
    lastSync: getProviderLastSyncAt(provider),
    lastSyncStatus: getProviderLastSyncMessage(provider),
  };
}

export function getConnectedProviderAccountName(provider: CloudProvider) {
  return getProviderAccountName(provider) ?? (readCloudSyncConfig(provider).enabled ? "Conta conectada" : null);
}

export { readAllLocalData };
