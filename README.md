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
