// content-loader.js
// Fetches content.json and populates all dynamic content on the page

async function loadContent() {
  const res = await fetch('content.json');
  const c = await res.json();

  // site notice
  const notice = document.querySelector('.site-notice p');
  if (notice && c.notice) {
    notice.innerHTML = `<strong>${c.notice.date}</strong> — ${c.notice.text}`;
  }

  // randomize main image
  if (c.images && c.images.length) {
    const pick = c.images[Math.floor(Math.random() * c.images.length)];
    const canvas = document.getElementById('main-canvas');
    const caption = document.getElementById('main-caption');
    if (canvas) canvas.dataset.src = pick.src;
    if (caption) caption.textContent = pick.caption;
  }

  // archive entries
  const entriesContainer = document.getElementById('entries-container');
  if (entriesContainer && c.entries) {
    entriesContainer.innerHTML = c.entries.map(e => `
      <div class="entry">
        <div class="entry-date">Entry ${e.id} — ${e.date} — ${e.type}</div>
        <p>${e.text}</p>
      </div>
    `).join('');
  }

  // related records panel
  const relatedContainer = document.getElementById('related-container');
  if (relatedContainer && c.related) {
    relatedContainer.innerHTML = c.related.map(r => `
      <div class="inner-panel-item"><a href="#">${r.id} — ${r.label}</a></div>
    `).join('');
  }

  // archive logs
  const logsContainer = document.getElementById('logs-container');
  if (logsContainer && c.logs) {
    logsContainer.innerHTML = c.logs.map(l => `
      <div class="log-entry">
        <div class="log-header">
          <span class="log-date">${l.date}</span>
          <span class="log-tag ${l.tagClass}">${l.tag}</span>
        </div>
        <p>${l.text}</p>
      </div>
    `).join('');
  }

  // archive meta
  const metaContainer = document.getElementById('meta-container');
  if (metaContainer && c.meta) {
    const rows = [
      ['Holdings', c.meta.holdings],
      ['Digitized', c.meta.digitized],
      ['Restricted', c.meta.restricted],
      ['Missing', c.meta.missing],
      ['Origin', c.meta.origin],
      ['Transferred', c.meta.transferred],
      ['Custodian', c.meta.custodian],
      ['Chain', c.meta.chain],
    ];
    metaContainer.innerHTML = rows.map(([k, v]) => `
      <div class="meta-row">
        <span class="meta-key">${k}</span>
        <span class="meta-val">${v}</span>
      </div>
    `).join('');
  }
}

loadContent();