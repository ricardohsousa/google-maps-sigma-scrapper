const fs = require("fs");
const path = require("path");

// Preferências da origem de extração (scraper x Places API oficial).
// A chave da API é cifrada com o cofre do sistema (DPAPI no Windows) quando
// disponível e nunca volta inteira para o renderer.
const SOURCES = ["scraper", "places-api"];
const DEFAULTS = { defaultSource: "scraper", placesApiKey: "" };

let overridePath = null;

function getFilePath() {
  if (overridePath) return overridePath;
  const { app } = require("electron");
  return path.join(app.getPath("userData"), "maps-settings.json");
}

function setPath(p) {
  overridePath = p;
}

function getSafeStorage() {
  try {
    const { safeStorage } = require("electron");
    return safeStorage?.isEncryptionAvailable?.() ? safeStorage : null;
  } catch {
    return null;
  }
}

function encodeKey(key) {
  if (!key) return "";
  const safe = getSafeStorage();
  return safe ? `enc:${safe.encryptString(key).toString("base64")}` : `raw:${key}`;
}

function decodeKey(stored) {
  if (!stored || typeof stored !== "string") return "";
  if (stored.startsWith("raw:")) return stored.slice(4);
  if (stored.startsWith("enc:")) {
    const safe = getSafeStorage();
    try {
      return safe ? safe.decryptString(Buffer.from(stored.slice(4), "base64")) : "";
    } catch {
      return "";
    }
  }
  return "";
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(getFilePath(), "utf-8"));
    return {
      defaultSource: SOURCES.includes(raw.defaultSource) ? raw.defaultSource : DEFAULTS.defaultSource,
      placesApiKey: decodeKey(raw.placesApiKey),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  const fp = getFilePath();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(
    fp,
    JSON.stringify({ defaultSource: settings.defaultSource, placesApiKey: encodeKey(settings.placesApiKey) }, null, 2),
    { mode: 0o600 },
  );
}

function maskKey(key) {
  if (!key) return "";
  return key.length <= 8 ? "••••" : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

/** Visão segura para o renderer: só a máscara da chave. */
function getPublic() {
  const s = load();
  return { defaultSource: s.defaultSource, hasPlacesApiKey: !!s.placesApiKey, placesApiKeyMask: maskKey(s.placesApiKey) };
}

/** `placesApiKey` ausente mantém a atual; string vazia remove. */
function update(patch = {}) {
  const current = load();
  const next = { ...current };
  if (SOURCES.includes(patch.defaultSource)) next.defaultSource = patch.defaultSource;
  if (typeof patch.placesApiKey === "string") next.placesApiKey = patch.placesApiKey.trim().slice(0, 200);
  save(next);
  return getPublic();
}

module.exports = { SOURCES, load, update, getPublic, setPath };
