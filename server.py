# server.py
import asyncio, json, time, uuid
from typing import Dict, List, Set
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn, socket

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

class Player:
    def __init__(self, pid: str, name: str, ws: WebSocket):
        self.id = pid
        self.name = name
        self.count = 0
        self.ws = ws
        self.last_seen = time.time()

class Room:
    def __init__(self, code: str):
        self.code = code
        self.players: Dict[str, Player] = {}
        self.conns: Set[WebSocket] = set()
        self.lock = asyncio.Lock()

    def leaderboard(self):
        return sorted(
            [{"id": p.id, "name": p.name, "count": p.count} for p in self.players.values()],
            key=lambda x: (-x["count"], x["name"].lower())
        )

rooms: Dict[str, Room] = {}

async def broadcast(room: Room, payload: dict):
    dead = []
    for ws in list(room.conns):
        try:
            await ws.send_text(json.dumps(payload))
        except Exception:
            dead.append(ws)
    for ws in dead:
        room.conns.discard(ws)

@app.websocket("/ws/{room_code}")
async def websocket_endpoint(websocket: WebSocket, room_code: str):
    await websocket.accept()
    name = (websocket.query_params.get("name") or "Player")[:32]
    pid = str(uuid.uuid4())[:8]

    room = rooms.setdefault(room_code.upper(), Room(room_code.upper()))
    async with room.lock:
        room.conns.add(websocket)
        p = Player(pid, name, websocket)
        room.players[pid] = p
        await broadcast(room, {"type": "join", "room": room.code, "players": room.leaderboard()})

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)

            if msg.get("type") == "update":
                cnt = int(msg.get("count", 0))
                async with room.lock:
                    if pid in room.players:
                        room.players[pid].count = cnt
                        room.players[pid].last_seen = time.time()
                    await broadcast(room, {"type": "leaderboard", "room": room.code, "players": room.leaderboard()})

            elif msg.get("type") == "ping":
                async with room.lock:
                    if pid in room.players:
                        room.players[pid].last_seen = time.time()

    except WebSocketDisconnect:
        pass
    finally:
        async with room.lock:
            room.conns.discard(websocket)
            room.players.pop(pid, None)
            await broadcast(room, {"type": "leave", "room": room.code, "players": room.leaderboard()})

# Serve ./web as the site root (http://localhost:8000/) — mount last so /ws works
app.mount("/", StaticFiles(directory="web", html=True), name="web")

def get_lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()

if __name__ == "__main__":
    host = "0.0.0.0"
    port = 8000
    ip = get_lan_ip()
    print(f"\nWebSocket URL for clients:\n  ws://{ip}:{port}\n")
    uvicorn.run("server:app", host=host, port=port, reload=False)
