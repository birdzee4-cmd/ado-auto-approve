// Headless UI prototype, deliberately outside public/. load is injected; this
// file makes no network calls and is not imported by the production archive.
export function createMonitoringController({ load, render }) {
  let sequence = 0;
  let active;
  let disposed = false;
  let state = { phase: 'idle', filters: null, data: null, errorCode: null };

  function publish(next) {
    state = next;
    render(structuredClone(state));
  }

  async function refresh(filters) {
    if (disposed) return;
    const token = ++sequence;
    active?.abort();
    active = new AbortController();
    const signal = active.signal;
    const selected = structuredClone(filters);
    // A filter change must not retain rows belonging to the previous filter.
    const sameFilters = state.filters !== null &&
      JSON.stringify(Object.entries(state.filters).sort()) === JSON.stringify(Object.entries(selected).sort());
    const previous = sameFilters ? state.data : null;
    publish({ phase: 'loading', filters: selected, data: previous, errorCode: null });
    try {
      const result = await load(structuredClone(selected), { signal });
      if (disposed || token !== sequence) return;
      if (!result || result.ok !== true || !Array.isArray(result.items) ||
          typeof result.fetchedAt !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(result.fetchedAt) ||
          !Number.isFinite(Date.parse(result.fetchedAt))) {
        throw new Error('INVALID_RESPONSE');
      }
      // fetchedAt comes from the response, never from a local refresh timestamp.
      const data = structuredClone(result);
      publish({ phase: data.items.length ? 'ready' : 'empty', filters: selected, data, errorCode: null });
    } catch (error) {
      if (disposed || token !== sequence) return;
      const status = error && error.status;
      const disabled = status === 503 && error.code === 'MONITORING_DISABLED';
      const errorCode = status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'FORBIDDEN'
        : disabled ? 'MONITORING_DISABLED' : status === 503 ? 'UNAVAILABLE' : 'LOAD_FAILED';
      const phase = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden'
        : previous ? 'stale' : disabled ? 'disabled' : 'error';
      // Drop protected rows on auth failure. Never show a failed request as zero.
      publish({ phase, filters: selected,
        data: status === 401 || status === 403 ? null : previous, errorCode });
    }
  }

  function dispose() {
    disposed = true;
    ++sequence;
    active?.abort();
    state = { phase: 'idle', filters: null, data: null, errorCode: null };
  }

  return { refresh, dispose, getState: () => structuredClone(state) };
}
