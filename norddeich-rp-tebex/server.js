require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TOKEN = (process.env.TEBEX_PUBLIC_TOKEN || "").trim();
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH || !SESSION_SECRET) {
  console.error("Fehlende Admin-Konfiguration. Prüfe die .env-Datei.");
  process.exit(1);
}
if (SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET muss mindestens 32 Zeichen lang sein.");
  process.exit(1);
}

app.disable("x-powered-by");
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null
    }
  }
}));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(session({
  name: "norddeich_admin",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 4
  }
}));
app.use(express.static(path.join(__dirname, "public")));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Zu viele Loginversuche. Bitte 15 Minuten warten." }
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin === true) return next();
  return res.status(401).json({ error: "Bitte zuerst als Admin anmelden." });
}

async function tebex(pathname, options = {}) {
  if (!TOKEN) throw new Error("TEBEX_PUBLIC_TOKEN fehlt in der .env-Datei. Admin-Login funktioniert, aber die Shop-Anbindung ist noch nicht eingerichtet.");
  const response = await fetch(`https://headless.tebex.io/api/accounts/${encodeURIComponent(TOKEN)}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `Tebex antwortete mit HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

app.get("/api/store", async (_req, res) => {
  try {
    const result = await tebex("/categories?includePackages=1");
    res.json({ data: result.data || [] });
  } catch (error) {
    console.error("Tebex store request failed:", error.message);
    res.status(502).json({ error: "Shopdaten konnten nicht von Tebex geladen werden. Prüfe den öffentlichen Store-Token." });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/admin/login", loginLimiter, async (req, res) => {
  const username = String(req.body?.username || "");
  const password = String(req.body?.password || "");
  const validUser = username.length === ADMIN_USERNAME.length &&
    require("crypto").timingSafeEqual(Buffer.from(username), Buffer.from(ADMIN_USERNAME));
  const validPassword = await bcrypt.compare(password, ADMIN_PASSWORD_HASH).catch(() => false);
  if (!validUser || !validPassword) {
    return res.status(401).json({ error: "Benutzername oder Passwort ist falsch." });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Login konnte nicht gestartet werden." });
    req.session.admin = true;
    req.session.adminName = ADMIN_USERNAME;
    res.json({ ok: true, username: ADMIN_USERNAME });
  });
});

app.get("/api/admin/session", (req, res) => {
  res.json({ authenticated: req.session?.admin === true, username: req.session?.adminName || null });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("norddeich_admin", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    res.json({ ok: true });
  });
});

app.get("/api/admin/store", requireAdmin, async (_req, res) => {
  try {
    const [store, categories] = await Promise.all([
      tebex(""),
      tebex("/categories?includePackages=1")
    ]);
    res.json({ store: store.data || store, categories: categories.data || [] });
  } catch (error) {
    console.error("Tebex admin data request failed:", error.message);
    res.status(502).json({ error: "Tebex-Daten nicht verfügbar. Bitte Token und Verbindung prüfen." });
  }
});

// Creates a Tebex basket for a package. This uses the public Headless API;
// actual price and checkout are handled by Tebex.
app.post("/api/basket", async (req, res) => {
  try {
    const packageId = String(req.body?.packageId || "");
    if (!/^\d{1,20}$/.test(packageId)) return res.status(400).json({ error: "Ungültige Paket-ID." });

    const basketResponse = await tebex("/baskets", {
      method: "POST",
      body: JSON.stringify({
        complete_url: `${SITE_URL}/?checkout=complete`,
        cancel_url: `${SITE_URL}/?checkout=cancel`,
        complete_auto_redirect: true
      })
    });
    const basket = basketResponse.data || basketResponse;
    const ident = basket.ident || basket.id;
    if (!ident) throw new Error("Tebex hat keine Basket-ID zurückgegeben.");

    const addResponse = await fetch(`https://headless.tebex.io/api/baskets/${encodeURIComponent(ident)}/packages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ package_id: packageId, quantity: 1 })
    });
    const addRaw = await addResponse.text();
    let addData;
    try { addData = addRaw ? JSON.parse(addRaw) : {}; } catch { addData = {}; }
    if (!addResponse.ok) throw new Error(addData?.message || "Paket konnte nicht zum Warenkorb hinzugefügt werden.");

    const updated = addData.data || addData;
    const checkoutUrl = updated.links?.checkout || updated.links?.payment || basket.links?.checkout ||
      `https://checkout.tebex.io/checkout/${encodeURIComponent(ident)}`;
    res.json({ checkoutUrl });
  } catch (error) {
    console.error("Basket creation failed:", error.message);
    res.status(502).json({ error: "Checkout konnte nicht gestartet werden. Bitte prüfe, ob das Paket aktiv und kaufbar ist." });
  }
});

app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API-Endpunkt nicht gefunden." });
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`Norddeich RP Shop läuft auf ${SITE_URL}`));
