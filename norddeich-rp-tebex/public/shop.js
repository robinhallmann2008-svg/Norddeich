const $ = (s) => document.querySelector(s);
$("#year").textContent = new Date().getFullYear();
const state = { categories: [], active: "all", query: "" };
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
function getPackages() {
  return state.categories.flatMap(category => (category.packages || []).map(pkg => ({ ...pkg, categoryName: category.name, categoryId: String(category.id) })));
}
function money(pkg) {
  if (pkg.total_price != null) return `${Number(pkg.total_price).toFixed(2)} ${pkg.currency || "EUR"}`;
  if (pkg.price != null) return typeof pkg.price === "number" ? `${pkg.price.toFixed(2)} €` : String(pkg.price);
  if (pkg.base_price != null) return `${Number(pkg.base_price).toFixed(2)} €`;
  return "Preis bei Tebex";
}
function renderFilters() {
  const el = $("#filters");
  el.innerHTML = `<button class="filter ${state.active === "all" ? "active" : ""}" data-category="all">Alle Pakete</button>` +
    state.categories.map(c => `<button class="filter ${state.active === String(c.id) ? "active" : ""}" data-category="${escapeHtml(c.id)}">${escapeHtml(c.name)}</button>`).join("");
  el.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => { state.active = btn.dataset.category; renderFilters(); renderProducts(); }));
}
function renderProducts() {
  const target = $("#products");
  let pkgs = getPackages();
  if (state.active !== "all") pkgs = pkgs.filter(p => p.categoryId === state.active);
  if (state.query) pkgs = pkgs.filter(p => `${p.name} ${p.description || ""} ${p.categoryName}`.toLowerCase().includes(state.query));
  if (!pkgs.length) {
    target.innerHTML = `<div class="empty">Keine Pakete gefunden. Prüfe deine Tebex-Kategorien oder ändere die Suche.</div>`;
    return;
  }
  target.innerHTML = pkgs.map((p, i) => `<article class="product-card">
    <div class="product-icon">${["✦","◈","⚡","◆","★"][i % 5]}</div>
    <h3>${escapeHtml(p.name || "Tebex-Paket")}</h3>
    <p>${escapeHtml((p.description || p.categoryName || "Offizielles Norddeich-RP-Paket").replace(/<[^>]*>/g, " ").slice(0, 170))}</p>
    <div class="product-bottom"><span class="price">${escapeHtml(money(p))}</span><button class="buy" data-package="${escapeHtml(p.id)}">Jetzt holen ↗</button></div>
  </article>`).join("");
  target.querySelectorAll(".buy").forEach(btn => btn.addEventListener("click", async () => {
    const old = btn.textContent; btn.disabled = true; btn.textContent = "Lädt…";
    try {
      const response = await fetch("/api/basket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId: btn.dataset.package }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Checkout nicht verfügbar.");
      if (!data.checkoutUrl || !/^https:\/\/(checkout\.tebex\.io|[^/]+\.tebex\.io)\//i.test(data.checkoutUrl)) throw new Error("Tebex hat keine gültige Checkout-Adresse zurückgegeben.");
      location.href = data.checkoutUrl;
    } catch (err) {
      alert(err.message || "Checkout konnte nicht geöffnet werden.");
      btn.disabled = false; btn.textContent = old;
    }
  }));
}
$("#search").addEventListener("input", e => { state.query = e.target.value.trim().toLowerCase(); renderProducts(); });
async function init() {
  try {
    const response = await fetch("/api/store");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Shop konnte nicht geladen werden.");
    state.categories = (result.data || []).filter(c => !c.hidden);
    renderFilters(); renderProducts();
    const count = getPackages().length;
    $("#status").textContent = count ? `${count} Paket(e) aus Tebex geladen.` : "Es wurden noch keine sichtbaren Pakete gefunden. Lege Kategorien und Pakete im Tebex Control Panel an.";
  } catch (error) {
    $("#status").classList.add("error");
    $("#status").textContent = error.message + " Trage den öffentlichen Tebex-Store-Token in die .env-Datei ein.";
    $("#products").innerHTML = '<div class="empty">Shopdaten sind derzeit nicht verfügbar.</div>';
  }
}
const params = new URLSearchParams(location.search);
if (params.get("checkout") === "complete") alert("Danke! Kehre in Norddeich RP zurück. Die tatsächliche Zahlung wird über Tebex bestätigt.");
if (params.get("checkout") === "cancel") alert("Der Checkout wurde abgebrochen.");
init();
