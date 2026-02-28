# logly

Offline desktop aplikácia pre tvorbu tréningových templateov, logovanie sérií a sledovanie progresu.

## Stack

- Electron
- SQLite (`better-sqlite3`)
- Vanilla HTML/CSS/JS

## Funkcie (MVP)

- Správa cvikov (`compound`, `isolation`, `bodyweight`)
- Variácie cvikov (napr. grip, postoj)
- Kategórie cvikov (napr. Push Day, Pull Day)
- Tvorba tréningových group (template workoutu)
- Spustenie tréningu z groupy
- Logovanie sérií (`reps`, `weight`, `RPE`, poznámka)
- Výpočet a ukladanie osobných rekordov:
  - `max_reps`
  - `max_weight`
  - `max_volume`
  - `est_1rm`
- Prehľad posledných tréningov a progres tabuliek

## Spustenie

```bash
npm install
npm run dev
```

`npm run dev` runs with renderer hot reload (without restarting Electron process).
If you want stable mode without hot reload, use:

```bash
npm run dev:stable
```

For one-time run without rebuild, use:

```bash
npm start
```

## Troubleshooting (better-sqlite3 / Electron ABI)

If you see an error like `NODE_MODULE_VERSION ... was compiled against a different Node.js version`,
run:

```bash
npm run rebuild:native
npm run dev
```

## Databáza

SQLite súbor sa vytvára automaticky v Electron `userData` adresári pod názvom `logly.db`.

## Poznámky

- Aplikácia je plne offline.
- Pri prvom spustení sa seednú základné kategórie (`Push Day`, `Pull Day`, `Leg Day`, ...).
