# My Social Networks API

My Social Networks API est une API REST développée avec Node.js, Express et MongoDB (via Mongoose). Elle permet de créer et de gérer des événements, des groupes, des fils de discussion, des albums photo, des sondages et une billetterie. Deux fonctionnalités bonus sont également réalisées : une shopping list (qui apporte quoi à un événement) et un système de covoiturage.

## Démarrage
Pour lancer le projet sur votre machine, installez d'abord les dépendances, créez votre fichier de configuration .env à partir du modèle fourni, puis démarrez le serveur. Dans le fichier .env, il faut renseigner JWT_SECRET (une longue chaîne aléatoire) et MONGODB_URI (l'adresse de votre base MongoDB).

```bash
npm install
cp .env.example .env        # puis renseigner JWT_SECRET (long et aléatoire) et MONGODB_URI
npm run docs                # (re)génère docs/openapi.json et docs/postman_collection.json
npm start                   # http://localhost:3000  — documentation interactive : /docs
```
Le rôle admin ne peut pas être obtenu via l'API : c'est volontaire, pour que personne ne puisse s'attribuer des droits d'administrateur. Un administrateur se crée uniquement avec le script ci-dessous
Créer un administrateur (le rôle `admin` ne peut pas être obtenu via l'API) :

```bash
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='UnMotDePasseSolide!1' npm run seed:admin
```

## Documentation Postman publiée

> **URL de la documentation Postman publiée : `https://documenter.getpostman.com/view/59274862/2sBYHbrbSx`**

La documentation complète de l'API est publiée en ligne et accessible sans connexion à l'adresse suivante :
  -https://documenter.getpostman.com/view/59274862/2sBYHbrbSx
Pour chaque service, elle présente l'URL, l'explication fonctionnelle, un exemple de corps de requête et un exemple de réponse avec les données renvoyées.
Pour la republier après une modification, il suffit d'importer docs/postman_collection.json dans Postman, d'ouvrir la collection, de cliquer sur View documentation puis sur Publish

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

Les données sont stockées dans plusieurs collections MongoDB :

users : les informations de l'utilisateur, avec un email unique, un mot de passe haché (bcrypt) et un rôle.
groups : le nom, la description, l'icône, la photo de couverture et le type du groupe (public, privé ou secret), les droits de publication et de création d'événements, ainsi que la liste des membres (au moins un) et des administrateurs (au moins un).
events : le nom, la description, les dates, le lieu, la photo de couverture, la visibilité, les organisateurs (au moins un), les participants, le groupe éventuel et les options activées (billetterie, shopping list, covoiturage).
threads et messages : un fil de discussion est lié à un groupe ou à un événement, jamais aux deux. Les messages portent un champ parent qui permet d'y répondre.
albums, photos et photocomments : un album est rattaché à un événement, les photos sont postées par des participants, et les commentaires aussi.
polls et pollanswers : un sondage comporte au moins une question, avec au moins deux réponses possibles chacune. Chaque participant choisit une seule réponse par question et ne peut participer qu'une fois.
tickettypes et tickets : les types de billets ont un nom, un montant et une quantité limitée. Un billet enregistre son type, le nom, le prénom, l'adresse complète et la date d'achat de l'acheteur. Une personne ne peut avoir qu'un seul billet par événement.
shoppingitems et carpools : les données des deux fonctionnalités bonus.

## Choix de conception 
L'énoncé laissait de la liberté sur certains points. Voici les décisions prises :

**Rôles locaux** : seuls les organisateurs d'un événement peuvent le modifier, créer des sondages et des types de billets. Seuls les participants peuvent poster des photos, des commentaires et répondre aux sondages. Seuls les administrateurs d'un groupe peuvent le gérer.
**Visibilité** : un événement privé ou un groupe secret est complètement invisible (réponse 404) pour les personnes non invitées, comme s'il n'existait pas. Un groupe privé affiche seulement une vue réduite aux non-membres.
**Groupes et événements** : quand on crée un événement dans un groupe, tous les membres sont invités automatiquement. Dans un groupe privé ou secret, l'événement est forcé en privé pour ne rien laisser fuiter. Le partage sur les réseaux sociaux n'est possible que pour un événement public d'un groupe public.
**Billetterie** : elle est réservée aux événements publics et l'achat est anonyme, puisqu'il s'adresse à des personnes extérieures. Le stock est décrémenté de **façon atomique** : lors du test, 10 achats simultanés pour 3 billets ont donné exactement 3 ventes.
**Fils de discussion** : un fil est créé automatiquement avec chaque groupe et chaque événement. Si l'option allowMembersToPost est désactivée sur un groupe, seuls les administrateurs peuvent y publier.

## Sécurité 

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
