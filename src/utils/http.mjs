export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Anti « mass assignment » : on ne copie que les champs explicitement autorisés
export const pick = (source, keys) => {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  keys.forEach((key) => {
    if (source[key] !== undefined) out[key] = source[key];
  });
  return out;
};

const OBJECT_ID = /^[a-f\d]{24}$/i;
export const isObjectId = (value) => typeof value === 'string' && OBJECT_ID.test(value);

export const validIds = (...names) => (req, res, next) => {
  const bad = names.find((name) => !isObjectId(req.params[name]));
  if (bad) return next(new HttpError(400, `Identifiant invalide : ${bad}`));
  return next();
};

export const paginate = (query) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

export const text = (value) => (typeof value === 'string' ? value : undefined);

// Recherche texte (« S » de CRUDS) : regex échappée => pas d'injection ni de ReDoS
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const searchFilter = (q, fields) => {
  if (typeof q !== 'string' || !q.trim()) return null;
  const regex = new RegExp(escapeRegex(q.trim().slice(0, 50)), 'i');
  return { $or: fields.map((field) => ({ [field]: regex })) };
};

// Fusionne un filtre de recherche dans un filtre existant
export const withSearch = (filter, q, fields) => {
  const search = searchFilter(q, fields);
  return search ? { $and: [filter, search] } : filter;
};

// Liste paginée standard : { page, limit, total, items }
export const listPage = async (Model, filter, query, sort) => {
  const { page, limit, skip } = paginate(query);
  const [items, total] = await Promise.all([
    Model.find(filter).sort(sort).skip(skip).limit(limit),
    Model.countDocuments(filter)
  ]);
  return { page, limit, total, items };
};
