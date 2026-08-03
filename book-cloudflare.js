(() => {
  const api = window.CLASSBOARD_API_URL || window.parent?.CLASSBOARD_API_URL;
  if (!api || api.includes('YOUR-SUBDOMAIN')) return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/api/classroom')) {
      return nativeFetch(`${api}${input.slice('/api/classroom'.length)}`, init);
    }
    return nativeFetch(input, init);
  };
  window.load?.();
})();
