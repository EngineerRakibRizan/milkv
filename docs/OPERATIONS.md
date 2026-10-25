# FarmOS — Operations

## Deploying with Docker Compose

```bash
cp backend/.env.production.example backend/.env.production   # fill APP_KEY, DB_PASSWORD, REVERB_* secrets
export DB_PASSWORD=...  REVERB_APP_KEY=...  APP_HOST=farm.example.com
docker compose up -d --build
docker compose exec api php artisan migrate --force
```

| Service | Role |
|---|---|
| `web` | nginx serving the built SPA. It proxies `/api` to `api` and `/app` (websocket) to `reverb`. |
| `api` | Laravel on FrankenPHP |
| `queue` | Queue worker |
| `scheduler` | Runs `farmos:alerts` hourly and `farmos:prune` daily |
| `reverb` | Websocket server for live updates |
| `postgres`, `redis` | Data, cache, locks, queues |
| `backup` | Nightly `pg_dump`, 14-day retention, written to `./backups` |

Put TLS in front of `web` (a reverse proxy, a load balancer or Cloudflare). Set
`APP_URL` to the public https URL.

## Farm backups (built into the app)

The owner manages these from **Settings → Data & backup**; the dashboard also has a Backup card.

| Format | File | Use it for |
|---|---|---|
| Full backup | `*.farmos.zip` | Restoring or moving to a new server. Contains every record, the uploaded files, and a manifest with SHA-256 checksums. |
| CSV | `*.csv.zip` | Opening in Excel: one CSV per table, with a README explaining units (money in paisa, quantities in thousandths). It can also be restored. |
| SQL | `*.sql` | A database administrator restoring into an **empty** FarmOS database. IDs are kept as they are. |

- **Restore always creates a new farm.** Every row gets a new ID and all references are re-mapped, so you can restore into a server that already has other farms. Nothing existing is overwritten. The whole import runs in one transaction.
- **Refused backups:**
  - An edited or damaged file.
  - A backup made by a newer FarmOS version than the server.
- **Staff logins are not included,** for security. After restoring, the owner re-adds the team under **Users & roles**.
- **Automatic backups:** `farmos:backup --all` runs nightly at 02:30, and each farm's last 14 days of backups are kept in `storage/app/backups/farm-<id>/`.

### Moving FarmOS to a new server

1. On the old server, go to **Settings → Data & backup → Full backup → Download**. From the command line instead: `php artisan farmos:backup <farm-id> --output=farm.farmos.zip`.
2. Install FarmOS on the new server and run `php artisan migrate`. Register the owner account.
3. On the new server, go to **Settings → Data & backup → Restore** and upload the file. From the command line instead: `php artisan farmos:import farm.farmos.zip --owner=you@example.com`.
4. Switch to the restored farm, check the dashboard, then re-add staff.

## Server backups and restore

**What is backed up:**
- The PostgreSQL database, nightly, in custom format (`backups/farmos-YYYY-MM-DD.dump`).
- Uploaded files in the `storage` volume. Back these up with your volume or snapshot tooling.

Copy `./backups` off the server, for example with `rclone` to cloud storage. A backup
that lives only on the same disk is not a backup.

**Restore:**

```bash
docker compose stop api queue scheduler reverb
docker compose exec -T postgres dropdb -U farmos farmos
docker compose exec -T postgres createdb -U farmos farmos
docker compose exec -T postgres pg_restore -U farmos -d farmos --no-owner < backups/farmos-2026-10-24.dump
docker compose start api queue scheduler reverb
docker compose exec api php artisan migrate --force   # in case the dump predates a migration
```

**Test the restore** into a scratch database every quarter. An untested backup does
not count.

## Configuration notes

- **Money and quantities** are stored as integers (paisa, milli-units). Do not change
  these columns to floats.
- **Locks.** Milk-stock and idempotency locks use the cache store, which must be Redis
  in production so that every API container shares them.
- **Token lifetime** is set by `SANCTUM_TOKEN_EXPIRATION` (minutes, default 30 days).
- **Alerts** come only from the scheduler. If the `scheduler` container stops,
  notifications stop too.
- **Email/SMS** delivery of alerts is not built in. It is an optional integration.

## Production readiness checklist

The core workflows are covered by automated tests. Before going live:

- [ ] Run the test suite against PostgreSQL (`DB_CONNECTION=pgsql` in `phpunit.xml`).
      The suite currently runs on SQLite.
- [ ] Set a strong `APP_KEY`, a strong database password and real Reverb secrets. Keep `APP_DEBUG=false`.
- [ ] Enable HTTPS and set `APP_URL`.
- [ ] Confirm `./backups` is copied off-server, and do one test restore.
- [ ] Create real owner accounts and remove the demo seed data (do not run `--seed` in production).
- [ ] Review role permissions in `backend/config/farmos.php` for your team.
- [ ] Load-test the delivery and milk endpoints with your expected number of users.
