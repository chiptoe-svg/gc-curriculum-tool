# GC Curriculum Tool — Disaster Recovery Runbook

This backup + the GitHub repo are everything needed to rebuild the tool on a bare Mac.

**The one thing not in any backup:** the encryption passphrase for `secrets.env.enc`.
It lives at `~/.config/gc-backup/passphrase` on the live machine **and** (you saved it here)
in your password manager. Without it, the secrets can't be decrypted — everything else
still restores, but you'd re-enter the API keys / Basic-Auth password by hand.

## What's in a backup

| File | What it is |
|---|---|
| `db.sql.gz` | `pg_dump` of the `gc_curriculum` Postgres DB |
| `materials.tar.gz` | uploaded material blobs → `~/.local/share/gc-curriculum-tool/materials` |
| `weaviate.tar.gz` | Weaviate vector store → `~/.weaviate/data` |
| `secrets.env.enc` | `.env.local`, AES-256 encrypted (openssl, passphrase) |
| `wiki.bundle` | git bundle of the `gc-curriculum-wiki` repo (self-contained) |
| `launchd/*.plist` | the `com.gc.*` + `com.weaviate` service definitions |
| `dev-ports.yaml` | local port registry |
| `manifest.json` | code commit SHA + git remotes + db name + paths |
| `SHA256SUMS` | checksums (restore/verify checks these) |

The **code** is not copied — `restore.sh` clones it from GitHub at the exact commit in `manifest.json`.

## Recover (one command)

On a fresh Mac with Homebrew, Node, pnpm, git, openssl, and Postgres.app installed
(and the `gc-pks` share mounted):

```bash
# 1. Get the restore script (it's in the repo, but you may not have the repo yet):
#    grab it straight out of the newest backup, which includes this runbook +
#    the scripts under scripts/backup once you clone — OR clone first:
git clone https://github.com/chiptoe-svg/gc-curriculum-tool.git ~/projects/curriculum_developer

# 2. Put the passphrase back (from your password manager):
mkdir -p ~/.config/gc-backup && chmod 700 ~/.config/gc-backup
printf '%s' 'YOUR-SAVED-PASSPHRASE' > ~/.config/gc-backup/passphrase
chmod 600 ~/.config/gc-backup/passphrase

# 3. Run the restore (defaults to the newest backup on the share):
~/projects/curriculum_developer/scripts/backup/restore.sh
```

`restore.sh` will: verify checksums → clone/checkout code at the recorded commit →
restore the wiki from its bundle → decrypt `.env.local` → recreate + load the DB →
unpack blobs + Weaviate → `pnpm install && pnpm build` → install the launchd services →
health-check. It asks before each destructive step.

## Verify a backup without restoring

```bash
scripts/backup/restore.sh verify            # newest backup
scripts/backup/restore.sh verify <dir>      # a specific backup
```

Checks checksums, test-decrypts the secrets, loads the DB dump into a throwaway
scratch database (then drops it), and lists the tarball contents. Mutates nothing.
Run it occasionally so a backup is never "assumed good."

## Manual piece-by-piece (if the script can't run)

```bash
B=/Volumes/gc-pks/gc_backups/gc_curriculum_<TS>
cd "$B" && shasum -a 256 -c SHA256SUMS                                   # integrity
openssl enc -d -aes-256-cbc -pbkdf2 -in secrets.env.enc \
  -out ~/projects/curriculum_developer/.env.local -pass file:~/.config/gc-backup/passphrase
createdb -h 127.0.0.1 -p 5433 gc_curriculum                             # if missing
gunzip -c db.sql.gz | psql "postgresql://…@127.0.0.1:5433/gc_curriculum"
tar -xzf materials.tar.gz -C ~/.local/share/gc-curriculum-tool/
launchctl bootout gui/$(id -u)/com.weaviate 2>/dev/null; rm -rf ~/.weaviate/data
tar -xzf weaviate.tar.gz -C ~/.weaviate/
git clone wiki.bundle ~/projects/gc-curriculum-wiki
cp launchd/*.plist ~/Library/LaunchAgents/
```

## Backup schedule

- **Full backup** (this): daily via launchd `com.gc.full-backup` → the `gc-pks` share, 30 kept.
- **DB-only** (independent second line): `pg-snapshot.sh` every 6h → local + weekly to GitHub
  `chiptoe-svg/gc-curriculum-backups`.
