const { validateFilters, validateId, ValidationError } = require('./deployment-monitoring-validation');
const { createCursorCodec } = require('./deployment-monitoring-cursor');

// Handler supplies validated filters; repository supplies restricted development DTOs.
// No endpoint registration or environment access happens here.
function createService({ repository, cursorSecret, storageTimezone, now = () => new Date() } = {}) {
  const codec = createCursorCodec({ secret: cursorSecret, storageTimezone, now });
  function raw(filters) {
    return { from: filters.from, to: filters.to, pageSize: String(filters.pageSize),
      q: filters.q, project: filters.project,
      ...(filters.status === null ? {} : { status: String(filters.status) }) };
  }
  return {
    async list(input) {
      const query = raw(input); const filters = validateFilters(query, now());
      const after = input.cursor ? codec.decode(input.cursor, filters) : null;
      const result = await repository.list(query, after);
      let nextCursor = null;
      if (result.page.hasMore) {
        const last = result.items.at(-1);
        if (!last || typeof last.TargetDate !== 'string') throw new Error('Invalid monitoring page');
        const suffix = storageTimezone === 'UTC' ? 'Z' : '+07:00';
        if (!last.TargetDate.endsWith(suffix)) throw new Error('Invalid monitoring date');
        nextCursor = codec.encode({ targetDate: last.TargetDate.slice(0, -suffix.length), id: last.ID }, filters);
      }
      return { ...result, page: { pageSize: filters.pageSize, hasMore: result.page.hasMore,
        paginationAvailable: true, nextCursor }, consistency: 'live' };
    },
    detail(id) { validateId(String(id)); return repository.detail(String(id)); },
    summary(input) {
      if (input.cursor) throw new ValidationError();
      return repository.summary(raw(input));
    }
  };
}
module.exports = { createService };
