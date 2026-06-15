/**
 * proxy-inject.js — Acoustic Campaign API Harness: Proxy Support Layer
 * Proxy URL is hardcoded; used implicitly on Get Token and ▶ Run.
 */
(function () {
  'use strict';

  var PROXY_URL = 'https://worker-old-water-3b9c.vaibhav-kadam.workers.dev';

  // 1. CAPTURE SELECTED OP via selectOp patch
  function patchSelectOp() {
    var orig = window.selectOp;
    if (!orig) { setTimeout(patchSelectOp, 120); return; }
    window.selectOp = function (op) {
      window.__proxyCurrentOp = op;
      return orig.apply(this, arguments);
    };
  }
  patchSelectOp();

  // 2. PATCH fetchToken TO ROUTE THROUGH PROXY
  function patchFetchToken() {
    var orig = window.fetchToken;
    if (!orig) { setTimeout(patchFetchToken, 120); return; }
    window.fetchToken = async function () {
      var clientId     = val('client-id');
      var clientSecret = val('client-secret');
      var refreshToken = val('refresh-token');
      var pod          = typeof getPod === 'function' ? getPod() : '';
      if (!pod || !clientId || !clientSecret || !refreshToken) {
        return orig.apply(this, arguments);
      }
      var bodyStr = new URLSearchParams({
        grant_type: 'refresh_token', client_id: clientId,
        client_secret: clientSecret, refresh_token: refreshToken,
      }).toString();
      var tokenBtn = document.getElementById('fetch-token-btn');
      if (tokenBtn) { tokenBtn.textContent = 'Fetching…'; tokenBtn.disabled = true; }
      try {
        var r = await fetch(PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: pod + '/oauth/token', method: 'POST', contentType: 'application/x-www-form-urlencoded', body: bodyStr }),
        });
        var data = {};
        try { data = await r.json(); } catch (e) {}
        if (data.access_token) {
          if (typeof storeToken === 'function') {
            storeToken(data.access_token, data.expires_in || 3600);
          } else {
            var m = document.getElementById('manual-token');
            if (m) { m.value = data.access_token; if (typeof onManualToken === 'function') onManualToken(); }
          }
          proxyToast('✓ Token fetched', 'green');
        } else {
          proxyToast('⚠ Token error: ' + (data.error_description || data.error || 'HTTP ' + r.status), 'red');
        }
      } catch (err) {
        proxyToast('⚠ ' + err.message, 'red');
      } finally {
        if (tokenBtn) { tokenBtn.textContent = 'Get Token'; tokenBtn.disabled = false; }
      }
    };
  }
  patchFetchToken();

  // 3. INJECT Run BUTTON VIA MutationObserver
  var RUN_ID  = 'proxy-run-btn';
  var RESP_ID = 'proxy-response-panel';

  function injectRunUI(outputPane) {
    if (!outputPane || outputPane.querySelector('#' + RUN_ID)) return;
    var outHdr = outputPane.querySelector('.out-hdr');
    if (outHdr) {
      var runBtn = document.createElement('button');
      runBtn.id = RUN_ID; runBtn.className = 'copy-btn';
      runBtn.textContent = '▶ Run'; runBtn.title = 'Run via proxy';
      runBtn.style.cssText = 'background:var(--green,#00b87c);color:#0a2a1a;font-weight:700;margin-left:6px';
      runBtn.onclick = runViaProxy;
      outHdr.appendChild(runBtn);
    }
    var panel = document.createElement('div');
    panel.id = RESP_ID;
    panel.style.cssText = 'display:none;border-top:1px solid var(--line,#d8d2c8);padding:12px 18px 14px;background:var(--bg2,#f9f7f5)';
    panel.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
        '<span style="font-size:9px;color:var(--muted,#5c5040);letter-spacing:2px;text-transform:uppercase;font-weight:600">Response</span>' +
        '<span id="proxy-resp-status" style="font-size:11px;font-family:monospace"></span>' +
        '<button onclick="document.getElementById(\'' + RESP_ID + '\').style.display=\'none\'" ' +
          'style="margin-left:auto;padding:3px 8px;background:transparent;border:1px solid var(--line,#d8d2c8);border-radius:6px;cursor:pointer;font-size:10px">✕</button>' +
      '</div>' +
      '<div id="proxy-resp-body" style="font-family:monospace;font-size:11.5px;line-height:1.7;white-space:pre-wrap;word-break:break-all;background:var(--bg,#fff);border:1.5px solid var(--line,#d8d2c8);border-radius:8px;padding:10px 14px;max-height:320px;overflow-y:auto"></div>';
    var curl = outputPane.querySelector('.curl-section');
    if (curl && curl.nextSibling) { outputPane.insertBefore(panel, curl.nextSibling); }
    else { outputPane.appendChild(panel); }
  }

  function attachObserver() {
    var content = document.getElementById('content');
    if (!content) { setTimeout(attachObserver, 200); return; }
    new MutationObserver(function () {
      var pane = content.querySelector('.output-pane');
      if (pane) injectRunUI(pane);
    }).observe(content, { childList: true, subtree: true });
  }
  attachObserver();

  // 4. runViaProxy
  async function runViaProxy() {
    var op = window.__proxyCurrentOp;
    if (!op) { proxyToast('⚠ Select an operation first', 'amber'); return; }

    var pod   = typeof getPod   === 'function' ? getPod()   : '';
    var token = typeof getToken === 'function' ? getToken() : (window.token || '');

    // Gather field values from DOM inputs
    var vals = {};
    if (op.sections) {
      op.sections.forEach(function (sec) {
        (sec.f || sec.fields || []).forEach(function (field) {
          var el = document.getElementById(field.id);
          if (el) vals[field.id] = el.value;
          else if (field.def !== undefined) vals[field.id] = field.def;
        });
      });
    }

    var endpoint, method, contentType, body;
    if (op.apiType === 'xml') {
      var built = '';
      try { built = op.build(vals); } catch (e) {}
      if (typeof built !== 'string') built = '';
      endpoint = pod + '/XMLAPI'; method = 'POST'; contentType = 'text/xml;charset=UTF-8'; body = built;
    } else {
      var builtR = {};
      try { builtR = op.build(vals) || {}; } catch (e) {}
      endpoint = pod + (builtR.url || ''); method = builtR.method || op.method || 'GET';
      contentType = 'application/json'; body = builtR.body || null;
    }

    var runBtn   = document.getElementById(RUN_ID);
    var panel    = document.getElementById(RESP_ID);
    var statusEl = document.getElementById('proxy-resp-status');
    var bodyEl   = document.getElementById('proxy-resp-body');

    if (runBtn)   { runBtn.textContent = 'Running…'; runBtn.disabled = true; }
    if (panel)    panel.style.display = 'block';
    if (bodyEl)   bodyEl.textContent = 'Sending…';
    if (statusEl) statusEl.textContent = '';

    try {
      var payload = { endpoint: endpoint, method: method, contentType: contentType };
      if (token && token !== 'YOUR_ACCESS_TOKEN') payload.token = token;
      if (body) payload.body = body;

      var r    = await fetch(PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      var text = await r.text();

      if (statusEl) {
        statusEl.textContent = 'HTTP ' + r.status;
        statusEl.style.color = r.ok ? 'var(--green,#00b87c)' : 'var(--red,#d63030)';
      }
      var display = text;
      try { display = JSON.stringify(JSON.parse(text), null, 2); } catch (e) {}
      if (bodyEl) bodyEl.textContent = display;
    } catch (err) {
      if (statusEl) { statusEl.textContent = 'Error'; statusEl.style.color = 'var(--red,#d63030)'; }
      if (bodyEl)   bodyEl.textContent = err.message;
    } finally {
      if (runBtn) { runBtn.textContent = '▶ Run'; runBtn.disabled = false; }
    }
  }
  window.runViaProxy = runViaProxy;

  // HELPERS
  function val(id) { return ((document.getElementById(id) || {}).value || '').trim(); }

  function proxyToast(msg, color) {
    if (typeof toast === 'function') { toast(msg); return; }
    var el = document.getElementById('proxy-toast-el');
    if (!el) {
      el = document.createElement('div');
      el.id = 'proxy-toast-el';
      el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:10px 18px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;display:none;box-shadow:0 4px 16px rgba(0,0,0,.2)';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = color === 'green' ? '#00b87c' : color === 'red' ? '#d63030' : '#e07000';
    el.style.color = color === 'green' ? '#0a2a1a' : '#fff';
    el.style.display = 'block';
    setTimeout(function () { el.style.display = 'none'; }, 2600);
  }
})();
