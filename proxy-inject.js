/**
 * proxy-inject.js — Acoustic Campaign API Harness: Proxy Support Layer
 *
 * Adds Cloudflare Worker proxy support to the Campaign API Harness without
 * modifying the main index.html beyond a single <script> tag.
 *
 * What this does:
 *   1. Injects a "Proxy URL" input row into the apibar
 *   2. Patches window.fetchToken to route OAuth through the proxy
 *   3. Uses MutationObserver to inject a "▶ Run" button + response panel
 *      into every operation's output pane
 *
 * Usage: add before </body> in index.html:
 *   <script src="proxy-inject.js"></script>
 */
(function () {
  'use strict';

  // ─── 1. INJECT PROXY URL ROW ─────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const apibar = document.getElementById('apibar');
    if (!apibar) return;

    const row = document.createElement('div');
    row.className = 'apibar-row';
    row.id = 'proxy-row';
    row.innerHTML = `
      <label>Proxy URL</label>
      <input
        type="text"
        id="proxy-url"
        placeholder="https://campaign-api-proxy.your.workers.dev"
        style="width:340px"
        title="Paste the Cloudflare Worker URL here to enable Run and proxy OAuth"
      />
      <a
        href="deploy-worker.html"
        target="_blank"
        style="font-size:11px;color:var(--amber);font-family:var(--ui,'Bricolage Grotesque',-apple-system,sans-serif);text-decoration:none;white-space:nowrap"
        title="Open the one-click worker deployer"
      >⚡ Deploy worker</a>
      <button
        id="proxy-test-btn"
        onclick="proxyTestConnection()"
        style="padding:4px 10px;background:transparent;border:1px solid var(--line,#d8d2c8);
               border-radius:6px;cursor:pointer;font-size:11px;color:var(--muted,#5c5040);
               font-family:var(--ui,'Bricolage Grotesque',-apple-system,sans-serif);white-space:nowrap"
        title="Verify the proxy is reachable"
      >Test</button>
    `;
    apibar.appendChild(row);
  });

  // ─── 2. PATCH fetchToken TO ROUTE THROUGH PROXY ───────────────────────────
  function patchFetchToken() {
    const orig = window.fetchToken;
    if (!orig) { setTimeout(patchFetchToken, 120); return; }

    window.fetchToken = async function () {
      const proxyUrl = proxyUrlValue();
      if (!proxyUrl) {
        return orig.apply(this, arguments);
      }

      const clientId     = val('client-id');
      const clientSecret = val('client-secret');
      const refreshToken = val('refresh-token');
      const pod          = typeof getPod === 'function' ? getPod() : '';

      if (!pod || !clientId || !clientSecret || !refreshToken) {
        return orig.apply(this, arguments);
      }

      const bodyStr = new URLSearchParams({
        grant_type:     'refresh_token',
        client_id:     clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }).toString();

      const tokenBtn = document.getElementById('fetch-token-btn');
      if (tokenBtn) { tokenBtn.textContent = 'Fetching…'; tokenBtn.disabled = true; }

      try {
        const r = await fetch(proxyUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint:    `${pod}/oauth/token`,
            method:      'POST',
            contentType: 'application/x-www-form-urlencoded',
            body:        bodyStr,
          }),
        });

        let data = {};
        try { data = await r.json(); } catch {}

        if (data.access_token) {
          if (typeof storeToken === 'function') {
            storeToken(data.access_token, data.expires_in || 3600);
          } else {
            const m = document.getElementById('manual-token');
            if (m) {
              m.value = data.access_token;
              if (typeof onManualToken === 'function') onManualToken();
            }
          }
          proxyToast('✓ Token fetched via proxy', 'green');
        } else {
          const msg = data.error_description || data.error || `HTTP ${r.status}`;
          proxyToast(`⚠ Token error: ${msg}`, 'red');
        }
      } catch (err) {
        proxyToast(`⚠ Proxy error: ${err.message}`, 'red');
      } finally {
        if (tokenBtn) { tokenBtn.textContent = 'Get Token'; tokenBtn.disabled = false; }
      }
    };
  }

  patchFetchToken();

  const RUN_ID  = 'proxy-run-btn';
  const RESP_ID = 'proxy-response-panel';

  function injectRunUI(outputPane) {
    if (!outputPane || outputPane.querySelector('#' + RUN_ID)) return;
    const outHdr = outputPane.querySelector('.out-hdr');
    if (outHdr) {
      const runBtn = document.createElement('button');
      runBtn.id        = RUN_ID;
      runBtn.className = 'copy-btn';
      runBtn.textContent = '▶ Run';
      runBtn.title     = 'Run via proxy worker';
      runBtn.style.cssText = 'background:var(--green,#00b87c);color:#0a2a1a;font-weight:700;margin-left:6px';
      runBtn.onclick   = runViaProxy;
      outHdr.appendChild(runBtn);
    }
    const panel = document.createElement('div');
    panel.id = RESP_ID;
    panel.style.cssText = 'display:none;border-top:1px solid var(--line,#d8d2c8);padding:12px 18px 14px;background:var(--bg2,#f9f7f5)';
    panel.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span style="font-size:9px;color:var(--muted,#5c5040);letter-spacing:2px;text-transform:uppercase;font-family:var(--ui);font-weight:600">Response</span><span id="proxy-resp-status" style="font-size:11px;font-family:var(--mono)"></span><button onclick="document.getElementById('${RESP_ID}').style.display='none'" style="margin-left:auto;padding:3px 8px;background:transparent;border:1px solid var(--line);border-radius:6px;cursor:pointer;font-size:10px;color:var(--muted);font-family:var(--ui)">✕</button></div><div id="proxy-resp-body" style="font-family:var(--mono);font-size:11.5px;line-height:1.7;white-space:pre-wrap;word-break:break-all;background:var(--bg);border:1.5px solid var(--line);border-radius:8px;padding:10px 14px;max-height:320px;overflow-y:auto"></div>`;
    const curl = outputPane.querySelector('.curl-section');
    if (curl && curl.nextSibling) { outputPane.insertBefore(panel, curl.nextSibling); }
    else { outputPane.appendChild(panel); }
  }

  function attachObserver() {
    const content = document.getElementById('content');
    if (!content) { setTimeout(attachObserver, 200); return; }
    new MutationObserver(() => {
      const pane = content.querySelector('.output-pane');
      if (pane) injectRunUI(pane);
    }).observe(content, { childList: true, subtree: true });
  }
  attachObserver();

  async function runViaProxy() {
    const proxyUrl = proxyUrlValue();
    if (!proxyUrl) { proxyToast('⚠ Enter a proxy URL first', 'amber'); return; }
    const op = window.current;
    if (!op) { proxyToast('⚠ Select an operation first', 'amber'); return; }
    const pod   = typeof getPod   === 'function' ? getPod()   : '';
    const token = typeof getToken === 'function' ? getToken() : (window.token || '');
    const vals  = window.vals || {};
    let endpoint, method, contentType, body;
    if (op.apiType === 'xml') {
      let built = ''; try { built = op.build(vals); } catch {}
      if (typeof built !== 'string') built = '';
      endpoint = `${pod}/XMLAPI`; method = 'POST'; contentType = 'text/xml;charset=UTF-8'; body = built;
    } else {
      let built = {}; try { built = op.build(vals) || {}; } catch {}
      endpoint = `${pod}${built.url || ''}`; method = built.method || op.method || 'GET';
      contentType = 'application/json'; body = built.body || null;
    }
    const runBtn = document.getElementById(RUN_ID);
    const panel = document.getElementById(RESP_ID);
    const statusEl = document.getElementById('proxy-resp-status');
    const bodyEl = document.getElementById('proxy-resp-body');
    if (runBtn) { runBtn.textContent = 'Running…'; runBtn.disabled = true; }
    if (panel) panel.style.display = 'block';
    if (bodyEl) bodyEl.textContent = 'Sending…';
    if (statusEl) statusEl.textContent = '';
    try {
      const payload = { endpoint, method, contentType };
      if (token && token !== 'YOUR_ACCESS_TOKEN') payload.token = token;
      if (body) payload.body = body;
      const r = await fetch(proxyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const text = await r.text();
      if (statusEl) { statusEl.textContent = `HTTP ${r.status}`; statusEl.style.color = r.ok ? 'var(--green)' : 'var(--red)'; }
      let display = text; try { display = JSON.stringify(JSON.parse(text), null, 2); } catch {}
      if (bodyEl) bodyEl.textContent = display;
    } catch (err) {
      if (statusEl) { statusEl.textContent = 'Error'; statusEl.style.color = 'var(--red)'; }
      if (bodyEl) bodyEl.textContent = err.message;
    } finally {
      if (runBtn) { runBtn.textContent = '▶ Run'; runBtn.disabled = false; }
    }
  }
  window.runViaProxy = runViaProxy;

  window.proxyTestConnection = async function () {
    const proxyUrl = proxyUrlValue();
    if (!proxyUrl) { proxyToast('⚠ Enter a proxy URL first', 'amber'); return; }
    const btn = document.getElementById('proxy-test-btn');
    if (btn) { btn.textContent = '…'; btn.disabled = true; }
    try {
      const r = await fetch(proxyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ probe: true }) });
      proxyToast(r.status < 500 ? '✓ Proxy reachable' : `⚠ HTTP ${r.status}`, r.status < 500 ? 'green' : 'amber');
    } catch (err) {
      proxyToast(`⚠ ${err.message}`, 'red');
    } finally {
      if (btn) { btn.textContent = 'Test'; btn.disabled = false; }
    }
  };

  function proxyUrlValue() { return ((document.getElementById('proxy-url') || {}).value || '').trim(); }
  function val(id) { return ((document.getElementById(id) || {}).value || '').trim(); }

  function proxyToast(msg, color) {
    if (typeof toast === 'function') { toast(msg); return; }
    let el = document.getElementById('proxy-toast-el');
    if (!el) {
      el = document.createElement('div'); el.id = 'proxy-toast-el';
      el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:10px 18px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;display:none;box-shadow:0 4px 16px rgba(0,0,0,.2);font-family:var(--ui)';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = color === 'green' ? 'var(--green,#00b87c)' : color === 'red' ? '#d63030' : '#e07000';
    el.style.color = color === 'green' ? '#0a2a1a' : '#fff';
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 2600);
  }
})();
