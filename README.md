# Comptes — zip 1 : fondations + suivi des dépenses

Next.js 14 · Supabase (Auth + Postgres + RLS) · Recharts · Vercel. Aucun identifiant bancaire stocké : import de CSV uniquement.

## Mise en route

1. **Supabase** (région UE)
   - Authentication → Users → *Add user* (email + mot de passe, « Auto Confirm ») pour les 2 utilisateurs.
   - Authentication → Sign In / Providers → Email : **désactiver « Allow new users to sign up »**.
   - SQL Editor → coller `supabase/schema.sql` → Run.
   - Project Settings → API : noter *Project URL* et clé **anon public**.
2. **GitHub** : pousser le contenu de ce dossier (le dossier `comptes`, pas le zip).
3. **Vercel** : Import du dépôt → Environment Variables :
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   puis Deploy. Ne **jamais** utiliser la clé `service_role` ici.
4. Local (optionnel) : copier `.env.example` en `.env.local`, puis `npm install && npm run dev`.

## Usage mensuel

1. **Réglages** : créer les comptes (un compte « commun » coché par l’un des deux, l’autre le voit automatiquement).
2. **Import** : choisir le compte, déposer le CSV du mois précédent. Aperçu, doublons ignorés, puis *Importer*.
3. **Opérations** : catégoriser le reste. Bouton *Règle* = applique la catégorie à tous les libellés similaires, présents et futurs.
4. **Tableau de bord** : Perso / Commun / Consolidé, période, filtres de catégories.

Astuce : sur le compte commun, créer la règle `nom prénom` → *Vir. compte commun* pour reconnaître les virements entrants de chacun.

## Règles comptables

- *Transfert interne* : ignoré partout.
- *Vir. compte commun* : dépense en vue Perso, revenu en vue Commun, exclu en Consolidé.
- Un crédit rangé dans une catégorie de dépense vient en déduction (remboursement).
- Opérations non catégorisées : sorties comptées en « Non catégorisé », entrées exclues jusqu’à catégorisation.

## Sécurité

- Row Level Security sur toutes les tables : compte perso = propriétaire seul ; compte commun = les 2 utilisateurs.
- La clé `anon` est publique par conception ; seule la RLS protège les données.
- Prévu ensuite : 2FA (TOTP Supabase).

## Ajouter une banque

`lib/parsers.js` → `parseBankCsv` (détection d’en-tête + sens des montants). Fournir un export anonymisé.

---

# Zip 2 — pots

**Mise à jour** : extraire le zip par-dessus le dépôt (écrase les fichiers modifiés), puis :
1. Supabase → SQL Editor → coller `supabase/002_pots.sql` → Run.
2. `git push` : Vercel redéploie.
3. Page **Pots** → « Créer les pots par défaut ».

Fichiers modifiés : `components/Shell.js`, `app/page.js`, `app/transactions/page.js`, `app/globals.css`, `lib/analytics.js`, `lib/categories.js`. Nouveaux : `app/pots/page.js`, `components/PotSplit.js`, `lib/pots.js`, `supabase/002_pots.sql`.

## Fonctionnement

- **Excédent du mois** = revenus − dépenses des comptes perso (virements vers le commun inclus), hors part payée par des pots.
- **Clôture** (onglet Mois) : excédent > 0 réparti selon les % ; « Reste » absorbe l’écart. Excédent < 0 : débité du pot Imprévu. Les % du mois précédent sont repris par défaut.
- **Réajuster un mois passé** : choisir le mois, modifier les %, « Recalculer et enregistrer ». Tous les soldes sont recalculés.
- **Dépense payée par un pot** : page Opérations, bouton « Pot » (dépenses des comptes perso). Répartition possible sur plusieurs pots, partielle ou totale. Le pot peut passer en négatif (alerte).
  Elle reste dans les graphes par catégorie ; case « Exclure les dépenses payées par un pot » sur l’Accueil pour la retirer.
- **Sous-pots / projets** : Gérer → Ajouter → « Sous-pot de… », puis Mouvements → Déplacer (pot → sous-pot). Le total du pot ne change pas.
- **Soldes initiaux** : Mouvements → date d’ouverture + montants.
- **Sankey** (Accueil, vue Perso, case cochée, mois clôturés) : l’excédent est réparti par pots.

---

# Zip 3 — patrimoine

**Mise à jour** : extraire par-dessus le dépôt, puis Supabase → SQL Editor → `supabase/003_placements.sql` → Run, `git push`.

Nouveaux : `app/patrimoine/page.js`, `lib/wealth.js`, `supabase/003_placements.sql`. Modifiés : `components/Charts.js`, `components/Shell.js`, `app/pots/page.js`, `app/globals.css`, `lib/categories.js`.

## Fonctionnement

- **Actifs** : nom, type, classe (liquidité, actions, obligations, immobilier, alternatif), enveloppe, montant investi (ou quantité × PRU), compte bancaire lié (optionnel). Valeur initiale saisie à la création.
- **Mise à jour** : une date, une valeur par ligne. Un compte lié propose le dernier solde importé.
- **Vue** : patrimoine, +/- value latente (actifs avec montant investi), évolution 1S / 1M / 3M / 6M / YTD / 1A / Tout, anneau par classe, type ou actif.
  Entre deux relevés la dernière valeur est reportée : les courtes périodes restent plates tant que les relevés sont mensuels.
- **Simulateur** : global ou par classe (capital, rendement, versement mensuel), durée, inflation. Intérêts composés mensuels, versements en fin de mois.
- **Pots** : la vue affiche l’écart entre les liquidités du patrimoine et le total des pots.

## Cours automatiques (PEA) — à venir

Les colonnes `isin`, `ticker`, `quantity` et `asset_values.price/source` sont déjà prêtes. L’étape suivante sera une tâche planifiée Vercel qui lit les cours via une API et enregistre un relevé quotidien (`source = 'api'`), sans toucher à la saisie manuelle.

---

## Correctifs

- `supabase/004_grants.sql` : à exécuter si une erreur « permission denied for table … » apparaît (droits d’accès aux tables manquants selon la configuration Supabase).
- Le titre de l’Accueil affiche le prénom tiré de l’email (`yann.martin@…` → « Yann »). Pour forcer un prénom : Supabase → Authentication → Users → utilisateur → *User Metadata* → `{"display_name": "Yann"}`.

---

# Bud-J — mise à jour design et fonctions

**Mise à jour** : extraire le zip complet à la racine du dépôt (écrase tout), puis Supabase → SQL Editor → `supabase/005_budj.sql` → Run (une fois), `git push`.

- **Design** : interface minimaliste, vert sauge, police système. Titre « Bud-J » en haut du menu, favicon 💰.
- **Catégories** : tags colorés, modifiables dans Réglages (couleur, nom, nouveaux tags dépense ou revenu). Communs aux deux utilisateurs. Nouvelle catégorie par défaut : **Placement** (virements vers PEA / assurance vie, reconnus automatiquement).
  Pour ne pas fausser l’excédent, impute ces virements au pot Investissement avec le bouton « Pot » de l’opération.
- **Opérations** : colonne « Compte », modification et suppression d’une ligne, ajout manuel. Un déficit s’affiche en négatif ; dans le Sankey il est ajouté aux revenus.
  Supprimer une ligne importée puis réimporter le même CSV la recrée.
- **Pots** : tirelire par pot (remplissage = part de l’objectif), objectifs avec horizon et effort mensuel estimé.
- **Patrimoine** : hiérarchie type de compte (courant / épargne / investissement) › enveloppe › actif. Import de portefeuille Bourse Direct (.xlsx ou .csv) depuis l’onglet Actifs : nouvelles lignes créées, lignes existantes mises à jour par ISIN, lignes absentes soldées si tu le souhaites.

---

# Bud-J v4

**Mise à jour** : extraire le zip complet à la racine du dépôt, exécuter `supabase/006_pots_detail.sql` dans Supabase (une fois), `git push`.

- **Opérations** : filtres par colonne (année, mois, compte, catégorie, montant) en plus de la recherche. Vue par défaut : mois en cours. Un nouvel ajout reprend les filtres qui n’ont qu’une valeur (catégorie, compte, sens, mois/année).
  Double-clic sur une cellule (date, année, libellé, compte, montant) pour la modifier ; la catégorie se change d’un clic. Le libellé est tronqué sur une ligne, visible en entier au double-clic. Bouton « Modifier » pour l’édition complète sur mobile.
- **Pots** : 4 par ligne maximum, couleur modifiable (Gérer › Couleur), clic sur un pot pour son contenu, ses sous-objectifs, son évolution et ses mouvements.
- **Versements** : la part d’un pot va au sous-objectif non atteint dont l’échéance est la plus proche ; sinon elle reste dans le pot (« Non affecté »).
- **Tableau de bord** : raccourcis vers Opérations, Pots, Patrimoine, et Réglages en bas de page.
