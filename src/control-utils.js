// Shared by the isolated annotator and page-world runtime; never changes form ownership.
(() => {
  const selector = 'input, select, textarea';
  const scopeSelector = 'fieldset, [role="form"], [role="search"], dialog, [role="dialog"], [role="group"][aria-label], [role="group"][aria-labelledby], section[aria-label], section[aria-labelledby]';
  const toolSelector = '[data-webmcp-complete-tool][data-webmcp-tool-description]';
  function scope(control) {
    if (control.form) return control.form;
    // Native radio groups share a form owner (including null), not necessarily a container.
    // ponytail: scans orphan radios per lookup; cache by DOM revision if large radio pages require it.
    if (control.type === 'radio' && control.name) {
      const peers = [...control.ownerDocument.querySelectorAll('input[type="radio"]')]
        .filter(peer => !peer.form && peer.name === control.name);
      let root = control;
      while (root && !peers.every(peer => root.contains(peer))) root = root.parentElement;
      return root || control;
    }
    return control.closest?.(scopeSelector) || control;
  }
  function controls(root) {
    if (root.tagName === 'FORM') return [...root.elements];
    const candidates = root.matches?.(selector) ? [root] : [...root.querySelectorAll(selector)];
    return candidates.filter(control => !control.form && scope(control) === root);
  }
  function visible(control) {
    return !control.closest?.('[hidden], [aria-hidden="true"], [inert]') &&
      (!control.checkVisibility || control.checkVisibility({visibilityProperty: true}));
  }
  const widgetSelector = 'summary, [role="combobox"][aria-controls], button[type="button"][aria-controls], [role="listbox"]';
  function popup(control) {
    return control.ownerDocument.getElementById(control.getAttribute('aria-controls'));
  }
  function widgetKind(control) {
    if (!control.matches?.(widgetSelector) || !visible(control) || control.matches(':disabled, [aria-disabled="true"]')) return null;
    if (control.matches('[role="listbox"]') && control.getAttribute('aria-multiselectable') !== 'true') return 'choose';
    if (control.matches('summary') && control.parentElement?.tagName === 'DETAILS') return 'expand';
    if (control.tagName === 'SELECT' || (control.matches(selector) && !control.readOnly)) return null;
    const target = popup(control);
    if (control.matches('[role="combobox"]') || control.getAttribute('aria-haspopup') === 'listbox' ||
        (control.hasAttribute('aria-expanded') && target && (target.matches(selector + ', [role="listbox"]') || target.querySelector(selector + ', [role="listbox"]')))) return 'expand';
    return null;
  }
  function options(root) {
    const used = new Set();
    return [...root.querySelectorAll('[role="option"]')]
      .filter(option => option.closest('[role="listbox"]') === root && visible(option) && option.getAttribute('aria-disabled') !== 'true')
      .map((option, index) => {
        const title = (option.getAttribute('aria-label') || option.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 150);
        const base = option.id || title || `option_${index + 1}`;
        let token = base;
        for (let suffix = 2; used.has(token); suffix++) token = `${base}_${suffix}`;
        used.add(token);
        return {option, title, token};
      });
  }
  function relevantMutation(mutation) {
    if (mutation.type !== 'childList') return true;
    const target = mutation.target;
    if (target.nodeType === 1 && (target.id || target.closest('label, legend, option, button, [role="option"]'))) return true;
    const semantic = 'form, input, select, textarea, option, optgroup, label, legend, fieldset, details, summary, [id], [role], [aria-label], [aria-labelledby]';
    return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
      node.isConnected || node.nodeType === 1 && (node.matches(semantic) || node.querySelector(semantic)));
  }
  function eligible(control) {
    return control.matches?.(selector) && !control.disabled && !control.matches(':disabled') &&
      !control.readOnly && visible(control) &&
      !['button', 'file', 'hidden', 'image', 'reset', 'submit'].includes(control.type);
  }
  function key(control) {
    return control.name || control.getAttribute('data-webmcp-field-key');
  }
  globalThis.__autoWebMcpControls = { selector, toolSelector, scope, controls, eligible, visible, key, widgetSelector, widgetKind, popup, options, relevantMutation };
})();
