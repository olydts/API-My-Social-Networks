// Génère docs/openapi.json et docs/postman_collection.json depuis docs/endpoints.mjs
import fs from 'node:fs';
import { rows, doc } from '../docs/endpoints.mjs';

const outDir = new URL('../docs/', import.meta.url);
// Exemples de réponses réelles capturés par `npm run docs:examples` (facultatif)
const examples = fs.existsSync(new URL('examples.json', outDir))
  ? JSON.parse(fs.readFileSync(new URL('examples.json', outDir), 'utf8'))
  : {};
const NOT_LIST = ['me', 'health', 'thread', 'results', 'ticket-types', 'share', 'join', 'leave'];
const isList = (method, pathOnly) => method === 'GET'
  && !pathOnly.split('/').pop().startsWith('{')
  && !NOT_LIST.includes(pathOnly.split('/').pop())
  && !/^\/(events|groups)\/\{\w+\}$/.test(pathOnly);
const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized',
  403: 'Forbidden', 404: 'Not Found', 409: 'Conflict'
};
const VARS = /\{\{(\w+)\}\}/g;
const DOC_VALUES = {
  emailA: 'alice@example.com', emailB: 'bob@example.com', emailC: 'carol@example.com',
  startDate: '2026-12-20T18:00:00.000Z', endDate: '2026-12-20T22:00:00.000Z', buyerEmail: 'jean.dupont@example.com'
};
const FAKE_ID = '665f1c2e8b1e4a0012345678';

const docValue = (name) => DOC_VALUES[name] || (name.endsWith('Id') ? FAKE_ID : `<${name}>`);
const forDocs = (value) => {
  if (typeof value === 'string') {
    return value.replace(/\{\{\$timestamp\}\}/g, '1700000000').replace(VARS, (m, n) => docValue(n));
  }
  if (Array.isArray(value)) return value.map(forDocs);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, forDocs(v)]));
  }
  return value;
};

const infer = (v) => {
  if (Array.isArray(v)) return { type: 'array', items: v.length ? infer(v[0]) : {} };
  if (v && typeof v === 'object') {
    return { type: 'object', properties: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, infer(x)])) };
  }
  if (typeof v === 'number') return { type: Number.isInteger(v) ? 'integer' : 'number' };
  if (typeof v === 'boolean') return { type: 'boolean' };
  return { type: 'string' };
};

const ERROR_TEXT = {
  400: 'Données invalides', 401: 'Non authentifié', 403: 'Droit insuffisant',
  404: 'Introuvable', 409: 'Conflit'
};

// ----------------------------- OpenAPI -----------------------------
const paths = {};
const tags = [];
const documented = rows.filter((r) => !r[7]?.negative);
const seen = new Set();

documented.forEach(([tag, name, method, fullPath, who, body, status, opts = {}]) => {
  const [path, queryString] = fullPath.split('?');
  const key = `${method} ${path}`;
  if (seen.has(key) || opts.hidden) return;
  seen.add(key);
  if (!tags.includes(tag)) tags.push(tag);

  const params = [...path.matchAll(/\{(\w+)\}/g)].map(([, n]) => ({
    name: n, in: 'path', required: true, schema: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' }
  }));
  if (isList(method, path)) {
    params.push(
      { name: 'page', in: 'query', description: 'Numéro de page (défaut 1)', schema: { type: 'integer', minimum: 1 } },
      { name: 'limit', in: 'query', description: 'Résultats par page (défaut 20, max 100)', schema: { type: 'integer', minimum: 1, maximum: 100 } },
      { name: 'q', in: 'query', description: 'Recherche texte (insensible à la casse)', schema: { type: 'string', maxLength: 50 } }
    );
  }
  void queryString;

  const op = {
    tags: [tag],
    summary: name,
    description: opts.desc,
    parameters: params,
    responses: {
      [status]: {
        description: status === 204 ? 'Succès, pas de contenu' : 'Succès',
        ...(status === 204 ? {} : {
          content: {
            'application/json': {
              schema: { type: 'object' },
              ...(examples[name]?.body !== undefined ? { example: examples[name].body } : {})
            }
          }
        })
      }
    }
  };
  if (who) op.security = [{ bearerAuth: [] }];
  if (body) {
    const example = forDocs(body);
    op.requestBody = {
      required: true,
      content: { 'application/json': { schema: infer(example), example } }
    };
  }
  const errors = [400, who ? 401 : null, who ? 403 : null, 404, ['POST', 'PATCH'].includes(method) ? 409 : null].filter(Boolean);
  errors.forEach((code) => {
    op.responses[code] = {
      description: ERROR_TEXT[code],
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
    };
  });
  paths[path] = { ...(paths[path] || {}), [method.toLowerCase()]: op };
});

const openapi = {
  openapi: '3.0.3',
  info: { title: doc.title, version: doc.version, description: doc.description },
  servers: [{ url: 'http://localhost:3000', description: 'Local' }],
  tags: tags.map((name) => ({ name })),
  paths,
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          code: { type: 'integer', example: 400 },
          message: { type: 'string', example: 'Données invalides' },
          errors: { type: 'object', additionalProperties: { type: 'string' } }
        }
      }
    }
  }
};

// ----------------------------- Postman -----------------------------
const TOKEN_VAR = { A: 'tokenA', B: 'tokenB', C: 'tokenC' };

const buildRequest = ([tag, name, method, fullPath, who, body, status, opts = {}]) => {
  const [path, queryString] = fullPath.split('?');
  const raw = `{{baseUrl}}${fullPath.replace(/\{(\w+)\}/g, '{{$1}}')}`;
  const request = {
    method,
    header: [],
    url: {
      raw,
      host: ['{{baseUrl}}'],
      path: path.split('/').filter(Boolean).map((s) => s.replace(/\{(\w+)\}/g, '{{$1}}')),
      ...(queryString ? {
        query: queryString.split('&').map((pair) => {
          const [key, value] = pair.split('=');
          return { key, value: (value || '').replace(/\{(\w+)\}/g, '{{$1}}') };
        })
      } : {})
    },
    description: opts.desc
  };
  if (body !== null && body !== undefined) {
    request.header.push({ key: 'Content-Type', value: 'application/json' });
    request.body = {
      mode: 'raw',
      raw: typeof body === 'string' ? body : JSON.stringify(body, null, 2),
      options: { raw: { language: 'json' } }
    };
  }
  if (who && typeof who === 'object') {
    request.header.push({ key: 'Authorization', value: who.raw });
  } else if (who) {
    request.auth = { type: 'bearer', bearer: [{ key: 'token', value: `{{${TOKEN_VAR[who]}}}`, type: 'string' }] };
  } else {
    request.auth = { type: 'noauth' };
  }

  const tests = [`pm.test('Statut ${status}', () => pm.response.to.have.status(${status}));`];
  const hasJson = status !== 204 && !(path === '/health' && opts.extraTests);
  if (hasJson || opts.saves || opts.extraTests?.some((l) => l.includes('json.'))) {
    tests.push("let json = {};", "try { json = pm.response.json(); } catch (e) { /* pas de JSON */ }");
  }
  if (status >= 400) {
    tests.push("pm.test('Erreur au format { code, message }', () => { pm.expect(json.code).to.be.a('number'); pm.expect(json.message).to.be.a('string'); });");
  }
  Object.entries(opts.saves || {}).forEach(([variable, expr]) => {
    tests.push(`pm.collectionVariables.set('${variable}', String(json.${expr}));`);
  });
  (opts.extraTests || []).forEach((line) => {
    tests.push(line.includes('json.') ? `pm.test('Contrôle de la réponse', () => { ${line} });` : `pm.test('En-têtes de sécurité', () => { ${line} });`);
  });

  const events = [{ listen: 'test', script: { type: 'text/javascript', exec: tests } }];
  if (opts.pre) events.unshift({ listen: 'prerequest', script: { type: 'text/javascript', exec: opts.pre } });
  // Exemple de réponse enregistré dans Postman (visible dans la documentation publiée)
  const example = examples[name];
  const response = example ? [{
    name: `${status} ${STATUS_TEXT[status] || ''}`.trim(),
    originalRequest: request,
    status: STATUS_TEXT[status] || '',
    code: status,
    _postman_previewlanguage: 'json',
    header: [{ key: 'Content-Type', value: 'application/json; charset=utf-8' }],
    body: example.body === undefined ? '' : JSON.stringify(example.body, null, 2)
  }] : [];
  return { name, event: events, request, response };
};

// L'ordre d'exécution global est conservé : on regroupe uniquement les lignes consécutives d'un même dossier.
const items = [];
rows.forEach((row) => {
  const last = items[items.length - 1];
  const req = buildRequest(row);
  if (last && last.name === row[0]) last.item.push(req);
  else items.push({ name: row[0], item: [req] });
});

const collection = {
  info: {
    name: 'My Social Networks API',
    description: doc.description,
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
  },
  item: items,
  variable: [
    { key: 'baseUrl', value: 'http://localhost:3000' },
    ...['tokenA', 'tokenB', 'tokenC', 'emailA', 'emailB', 'emailC', 'startDate', 'endDate'].map((key) => ({ key, value: '' }))
  ]
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(new URL('openapi.json', outDir), `${JSON.stringify(openapi, null, 2)}\n`);
fs.writeFileSync(new URL('postman_collection.json', outDir), `${JSON.stringify(collection, null, 2)}\n`);
console.log(`OpenAPI : ${Object.keys(paths).length} chemins, ${seen.size} opérations`);
console.log(`Postman : ${rows.length} requêtes dans ${items.length} dossiers`);
