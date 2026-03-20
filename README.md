# ChatFC

IRC-style self-hosted chat server — Rust backend + vanilla JS frontend.

## Key paths (relative to the server working directory)
- Database: `data/chatfc.db`
- Uploads (files + images): `uploads/`
- Frontend static files: `frontend/`

## Features
- Real-time WebSocket chat
- Emoji reactions (click `[+]` on any message)
- `@mention` with autocomplete (Tab/Enter), desktop beep & highlight
- File & image upload (drag-drop or 📎 button, images shown inline)
- Online user list with click-to-mention
- Retro terminal / IRC aesthetic

## Build & run

Note: the server uses relative paths (`data/chatfc.db`, `uploads/`, `frontend/`) based on the directory where you start the `chatserver` binary.

```bash
cd backend
cargo build --release
cp -r ../frontend target/release/frontend

# If the directories don't exist yet, the server will create them automatically.
# (DB: data/chatfc.db, uploads: uploads/)

# Run (default port 3000)
./target/release/chatserver

# Custom port
PORT=8080 ./target/release/chatserver
```

## Development (hot-reload frontend)

```bash
cd backend
cargo run
```

Open `http://localhost:3000` in your browser.

## Docker / Docker Compose

This repo includes a `Dockerfile` and a `docker-compose.yml`.

```bash
docker compose up -d --build

# Logs
docker compose logs -f
```

Persistence:
- `./data` on the host is mounted into the container as `/app/data` (SQLite DB at `data/chatfc.db`)
- `./uploads` on the host is mounted into the container as `/app/uploads`

Frontend:
- the Docker image bakes the `frontend/` folder, but `docker-compose.yml` bind-mounts `./frontend` read-only for easier updates

## Directory layout

```
chatfcdev/
├── backend/
│   ├── Cargo.toml
│   └── src/main.rs
├── frontend/
├── data/         # created at runtime (SQLite DB: data/chatfc.db)
├── uploads/      # created at runtime
├── Dockerfile
└── docker-compose.yml
```

## Deployment tip (home server)

Copy the release binary **and** the `frontend/` folder to the same directory,
then run as a systemd service or with `screen`/`tmux` (the server will create/use `data/chatfc.db` and `uploads/` there).

```
[Unit]
Description=ChatFC

[Service]
WorkingDirectory=/opt/chatfc
ExecStart=/opt/chatfc/chatserver
Restart=always
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```
