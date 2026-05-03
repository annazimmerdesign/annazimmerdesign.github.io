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
    const pick = c.images[0]; // always same image — consistent state for all visitors
    const canvas = document.getElementById('main-canvas');
    const caption = document.getElementById('main-caption');
    if (caption) caption.textContent = pick.caption;
    if (canvas) {
      canvas.dataset.src = pick.src;
      const img = new Image();
      img.onload = () => {
        const ratio = img.naturalHeight / img.naturalWidth;
        canvas.height = Math.round(canvas.width * ratio);
      };
      img.src = pick.src;
    }
  }

  // archive entries
  const entriesContainer = document.getElementById('entries-container');
  if (entriesContainer && c.entries) {
    entriesContainer.innerHTML = c.entries.map(e => `
  <div class="entry" data-degrade="0">
    <div class="entry-date">Entry ${e.id} — ${e.date} — ${e.type}</div>

    <div class="entry-text collapsed">
      ${e.text}
    </div>

    <div class="entry-controls">
      <span class="read-more">[ expand record ]</span>
    </div>
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
document.dispatchEvent(new Event('contentLoaded'));
  setTimeout(() => {
    if (window.wrapAllParagraphs) window.wrapAllParagraphs();
    if (typeof registerImagesWithServer === 'function') registerImagesWithServer();
  }, 600);
}

document.addEventListener("click", (e) => {
  if (!e.target.classList.contains("read-more")) return;
  const text = e.target.closest(".entry")?.querySelector(".entry-text");
  if (!text) return;
  text.classList.toggle("expanded");
  e.target.textContent = text.classList.contains("expanded")
    ? "[ collapse record ]"
    : "[ expand record ]";
});

document.querySelectorAll(".entry-text").forEach(el => {
  const variance = Math.random() * 2 + 3.5; // 3.5–5.5 lines
  el.style.maxHeight = variance + "em";
});

loadContent();