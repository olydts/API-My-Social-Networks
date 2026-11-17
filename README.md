# My Social Networks API

API REST (Node.js, Express, MongoDB/Mongoose) pour créer et gérer des **événements**, **groupes**, **fils de discussion**, **albums photo**, **sondages** et une **billetterie**. Bonus réalisés : **shopping list** et **covoiturage**.

## Démarrage

```bash
npm install
cp .env.example .env        # puis renseigner JWT_SECRET (long et aléatoire) et MONGODB_URI
npm run docs                # (re)génère docs/openapi.json et docs/postman_collection.json
npm start                   # http://localhost:3000  — documentation interactive : /docs
```

Créer un administrateur (le rôle `admin` ne peut pas être obtenu via l'API) :

```bash
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='UnMotDePasseSolide!1' npm run seed:admin
```

## Documentation Postman publiée

> **URL de la documentation Postman publiée : `https://documenter.getpostman.com/view/59274862/2sBYHbrbSx`**

Pour obtenir cette URL : dans Postman, importer `docs/postman_collection.json`, ouvrir la collection, cliquer sur **View documentation** puis **Publish**, et copier l'adresse publique générée. La collection contient pour chaque service l'URL, l'explication fonctionnelle, un exemple de corps de requête et un **exemple de réponse** (données renvoyées).

## Documentation et Postman

- **Swagger UI** : `GET /docs` (généré depuis `docs/openapi.json`).
- **Postman** : importer `docs/postman_collection.json` (`File > Import`). La collection contient 151 requêtes ordonnées (dont les cas d'erreur), des exemples de réponses réelles, et des scripts de test qui enregistrent automatiquement `token*`, `eventId`, `groupId`… dans les variables de collection. Lancer le **Collection Runner** (ou `newman run docs/postman_collection.json --env-var baseUrl=http://localhost:3000`) pour rejouer tout le scénario.
- Les fichiers sont générés depuis une seule source (`docs/endpoints.mjs`) : la doc et les tests ne peuvent pas diverger. Les exemples de réponses (`docs/examples.json`) sont capturés lors d'un vrai passage des tests : `MONGODB_URI=... npm run docs:examples`.
- **Test de bout en bout** : `MONGODB_URI=mongodb://127.0.0.1:27017/msn_e2e npm run test:e2e` (vide la base indiquée puis exécute la collection avec Newman).

## CRUDS : couverture par ressource

C = Create (`POST`), R = Read (`GET`), U = Update (`PATCH`), D = Delete (`DELETE`), S = Search (`?q=`).

| Ressource | C | R | U | D | S |
|---|---|---|---|---|---|
| Utilisateurs | `/auth/register` | `/users/{id}`, `/auth/me` | `PATCH /users/me` | `DELETE /users/me` (+ admin `DELETE /users/{id}`) | `GET /users/search?q=` |
| Groupes | `POST /groups` | `GET /groups`, `/groups/{id}` | `PATCH /groups/{id}` | `DELETE /groups/{id}` | `GET /groups?q=&type=` |
| Événements | `POST /events` | `GET /events`, `/events/{id}` | `PATCH /events/{id}` | `DELETE /events/{id}` | `GET /events?q=&from=&to=` |
| Discussions (messages, réponses) | `POST /threads/{id}/messages` | `GET /threads/{id}/messages`, `/messages/{id}` | `PATCH /messages/{id}` | `DELETE /messages/{id}` | `…/messages?q=` |
| Albums | `POST /events/{id}/albums` | `GET /albums/{id}` | `PATCH /albums/{id}` | `DELETE /albums/{id}` | `…/albums?q=` |
| Photos, commentaires | `POST /albums/{id}/photos`, `/photos/{id}/comments` | `GET /photos/{id}` | `PATCH /photos/{id}`, `/comments/{id}` | `DELETE …` | `…?q=` |
| Sondages | `POST /events/{id}/polls` | `GET /polls/{id}`, `/results` | `PATCH /polls/{id}` | `DELETE /polls/{id}` | `…/polls?q=` |
| Billetterie | `POST /events/{id}/ticket-types`, `/tickets` | `GET /tickets/{id}` | `PATCH /ticket-types/{id}`, `/tickets/{id}` | `DELETE /ticket-types/{id}`, `/tickets/{id}` | `…/tickets?q=` |
| Shopping list (bonus) | `POST …/shopping-items` | `GET /shopping-items/{id}` | `PATCH /shopping-items/{id}` | `DELETE …` | `…?q=` |
| Covoiturage (bonus) | `POST …/carpools` | `GET /carpools/{id}` | `PATCH /carpools/{id}` | `DELETE …` | `…?q=` |

**Performance** : toutes les listes sont paginées (`?page=1&limit=20`, max 100) et renvoient `{ page, limit, total, items }` ; les recherches utilisent des expressions régulières échappées (pas d'injection) ; les achats de billets et réservations de places utilisent des mises à jour atomiques (pas de surréservation sous charge) ; les principales références (événement, album, fil…) sont indexées.

## Architecture

```
src/
  config.mjs            configuration (variables d'environnement)
  app.mjs / index.mjs   application Express / démarrage + connexion MongoDB
  middlewares/          auth (JWT, RBAC), security (rate limit, anti-injection NoSQL), errors
  models/               un fichier par domaine (Mongoose + validators)
  routes/               auth, users, groups, events, threads, albums, polls, tickets, extras
  services/access.mjs   règles d'accès (organisateur, participant, membre, administrateur)
docs/                   endpoints.mjs (source), openapi.json, postman_collection.json
scripts/                generate-docs, seed-admin, run-e2e
```

## Modèle de données (collections)

| Collection | Contenu |
|---|---|
| `users` | attributs de l'utilisateur, email **unique**, mot de passe haché (bcrypt), rôle |
| `groups` | nom, description, icône, couverture, type (public/privé/secret), droits de publication et de création d'événements, `members` (≥1), `admins` (≥1) |
| `events` | nom, description, dates, lieu, couverture, visibilité, `organizers` (≥1), `participants`, groupe éventuel, options (billetterie, shopping list, covoiturage) |
| `threads`, `messages` | un fil lié à **un groupe OU un événement** (jamais les deux) ; messages avec `parent` pour les réponses |
| `albums`, `photos`, `photocomments` | album → 1 événement ; photos postées par un participant ; commentaires par des participants |
| `polls`, `pollanswers` | sondage (≥1 question, ≥2 réponses par question) ; **une** réponse choisie par question, une participation par utilisateur |
| `tickettypes`, `tickets` | types de billets (nom, montant, quantité limitée) ; billets (type, nom, prénom, adresse complète, date d'achat), **un seul billet par personne et par événement** |
| `shoppingitems`, `carpools` | bonus |

## Choix de conception (là où l'énoncé laissait carte blanche)

- **Rôles locaux** : seuls les organisateurs modifient l'événement, créent sondages et billets ; seuls les participants postent photos, commentaires, réponses ; seuls les administrateurs gèrent le groupe.
- **Visibilité** : un événement privé ou un groupe secret est **invisible** (404) pour les non-invités. Un groupe privé affiche une vue réduite aux non-membres.
- **Groupes** : créer un événement dans un groupe invite automatiquement tous les membres. Dans un groupe privé/secret, l'événement est forcé en privé. Le partage sur les réseaux sociaux n'est possible que pour un événement public d'un groupe public.
- **Billetterie** : réservée aux événements publics. L'achat est **anonyme** (« personne extérieure »). Le stock est décrémenté de façon atomique : 10 achats simultanés pour 3 billets donnent exactement 3 ventes (testé).
- **Fils de discussion** : créés automatiquement avec le groupe ou l'événement. Si `allowMembersToPost` est faux, seuls les administrateurs publient.

## Sécurité (cours « API & Sécurité »)

| Risque | Mesure |
|---|---|
| Authentification | JWT `HS256` **imposé** à la vérification (contre *none alg* et *algorithm confusion*), expiration 1h, mots de passe hachés avec bcrypt |
| Secrets | `JWT_SECRET` et accès MongoDB dans `.env` (jamais versionné), erreur au démarrage en production si absent |
| Contrôle d'accès | RBAC (`user`/`admin`), règles locales par ressource, pas d'auto-promotion (`role` ignoré à l'inscription), liste complète des utilisateurs réservée aux admins (la recherche publique `/users/search` n'expose jamais l'email) |
| Validation des entrées | validators Mongoose (formats, bornes, enums, URL http/https, email), identifiants ObjectId contrôlés, champs autorisés listés (anti *mass assignment*) |
| Injection NoSQL | suppression des clés `$…` et `a.b` dans body/query/params ; types vérifiés |
| DoS / brute force | `express-rate-limit` global et plus strict sur `/auth`, taille du corps limitée à 10 Ko |
| Fuite d'informations | `X-Powered-By` désactivé, erreurs internes génériques (500) sans détail, même message pour « email inconnu » et « mauvais mot de passe » |
| En-têtes HTTP | `helmet` |
| CORS | origines explicites (`CORS_ORIGINS`), jamais `*` avec credentials |
| Transport | à servir derrière HTTPS (reverse proxy Nginx ou serveur `https` Node avec certificat) |

## Codes de réponse

`400` données invalides · `401` non authentifié · `403` droit insuffisant · `404` introuvable/invisible · `409` conflit (doublon, plus de place) · `413` corps trop gros · `429` trop de requêtes. Format des erreurs : `{ "code": 400, "message": "…", "errors": { "champ": "explication" } }`.
