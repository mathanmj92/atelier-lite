// Atelier has one AI, in its own side panel. The apps' built-in assistants are hidden
// so there is a single place to ask, and nothing half-working beside it.
(() => {
  const style = document.createElement('style');
  style.id = 'atelier-no-ai';
  style.textContent = `
    /* Documents */
    .as-title-button, .as-fab, aside.rv-pane, aside.ref-lookup-pane, .rv-ai-toggle, .rv-ai-body { display: none !important; }
    /* Presentation */
    #ai-panel, button.ai-toggle { display: none !important; }
    /* anything we hide by name below */
    [data-atelier-hidden] { display: none !important; }
  `;
  (document.head || document.documentElement).append(style);

  // Short buttons and menu items that are about AI: "Ask AI", "AI Assistant", "Smart Lookup"...
  const AI = /(^|\W)(AI|A\.I\.)(\W|$)|assistant|copilot|smart lookup|with AI/i;
  const SKIP_TAG = /^(INPUT|TEXTAREA|SELECT)$/;
  function sweep() {
    const nodes = document.querySelectorAll('button, [role="menuitem"], [role="tab"], .ribbon-command, .ribbon-btn, .ribbon-large, .tb-btn, li[role], a[role="button"]');
    for (const n of nodes) {
      if (n.hasAttribute('data-atelier-hidden') || SKIP_TAG.test(n.tagName)) continue;
      const label = ((n.getAttribute('aria-label') || '') + ' ' + (n.getAttribute('title') || '') + ' ' + (n.textContent || '')).trim();
      if (label.length > 60 || !AI.test(label)) continue;
      n.setAttribute('data-atelier-hidden', '');
    }
  }
  let timer = 0;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      sweep();
    }, 400);
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  sweep();
})();
