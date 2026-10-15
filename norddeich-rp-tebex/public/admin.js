const $ = s => document.querySelector(s);
$("#year").textContent = new Date().getFullYear();
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function showDashboard(username) {
  $("#loginCard").hidden = true; $("#dashboard").hidden = false; $("#adminName").textContent = username || "admin"; loadAdminData();
}
async function checkSession() {
  try { const r = await fetch("/api/admin/session"); const d = await r.json(); if (d.authenticated) showDashboard(d.username); }
  catch {}
}
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault(); const form = new FormData(e.currentTarget);
  const error = $("#loginError"); error.textContent = "";
  const btn = e.currentTarget.querySelector("button"); btn.disabled = true; btn.textContent = "Anmeldung läuft…";
  try {
    const r = await fetch("/api/admin/login", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({username:form.get("username"),password:form.get("password")}) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error || "Login fehlgeschlagen.");
    e.currentTarget.reset(); showDashboard(d.username);
  } catch (err) { error.textContent = err.message; }
  finally { btn.disabled = false; btn.innerHTML = 'Sicher anmelden <span>→</span>'; }
});
$("#logout").addEventListener("click", async () => {
  await fetch("/api/admin/logout", {method:"POST"});
  $("#dashboard").hidden = true; $("#loginCard").hidden = false;
});
async function loadAdminData() {
  const status = $("#adminStatus"); status.textContent = "Lade Tebex-Shopdaten…"; status.className = "status";
  try {
    const r = await fetch("/api/admin/store"); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Daten konnten nicht geladen werden.");
    const cats = d.categories || []; const pkgs = cats.flatMap(c => (c.packages || []).map(p => ({...p, cat:c.name})));
    $("#connectionStatus").textContent = "Verbunden"; $("#connectionStatus").style.color = "var(--green)";
    $("#categoryCount").textContent = cats.length; $("#packageCount").textContent = pkgs.length;
    status.textContent = pkgs.length ? "Shopdaten erfolgreich geladen." : "Verbindung steht. Noch keine sichtbaren Pakete vorhanden.";
    $("#adminPackages").innerHTML = pkgs.length ? pkgs.map(p => `<div class="admin-package"><div><b>${esc(p.name || "Paket")}</b><small>${esc(p.cat || "Ohne Kategorie")} · ID ${esc(p.id)}</small></div><span class="price">${p.total_price != null ? esc(Number(p.total_price).toFixed(2) + " " + (p.currency || "EUR")) : p.price != null ? esc(typeof p.price === "number" ? p.price.toFixed(2) + " €" : p.price) : "Preis in Tebex"}</span></div>`).join("") : "";
  } catch (err) {
    $("#connectionStatus").textContent = "Nicht verbunden"; $("#connectionStatus").style.color = "var(--danger)";
    status.classList.add("error"); status.textContent = err.message; $("#adminPackages").innerHTML = "";
  }
}
checkSession();
