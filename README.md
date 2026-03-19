# ChatFC

IRC-style self-hosted chat server — Rust backend + vanilla JS frontend.

## Features
- Real-time WebSocket chat
- Emoji reactions (click `[+]` on any message)
- `@mention` with autocomplete (Tab/Enter), desktop beep & highlight
- File & image upload (drag-drop or 📎 button, images shown inline)
- Online user list with click-to-mention
- Retro terminal / IRC aesthetic

## Build & run

```bash
cd backend
cargo build --release
cp -r ../frontend target/release/   # or set FRONTEND path

# Run (default port 3000)
./target/release/chatserver

# Custom port
PORT=8080 ./target/release/chatserver
```

The server serves the frontend from `./frontend/` relative to the binary's
working directory, and stores uploads in `./uploads/`.

## Development (hot-reload frontend)

```bash
cd backend
cargo run
```

Open `http://localhost:3000` in your browser.

## Directory layout

```
chatfcdev/
├── backend/
│   ├── Cargo.toml
│   └── src/main.rs
└── frontend/
    ├── index.html
    ├── style.css
    └── app.js
```

## Deployment tip (home server)

Copy the release binary **and** the `frontend/` folder to the same directory,
then run as a systemd service or with `screen`/`tmux`.

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
