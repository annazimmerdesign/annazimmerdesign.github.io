"""
server.py — Dukhtar, Dispossessed
Flask-SocketIO live damage layer.
"""

from flask import Flask
from flask_socketio import SocketIO, emit
import json
import math
import requests
import threading

app = Flask(__name__)
app.config['SECRET_KEY'] = 'dukhtar-secret-change-in-prod'

ALLOWED_ORIGINS = [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:3000",
    "https://annazimmerdesign.github.io",
]

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode='gevent',
    logger=False,
    engineio_logger=False
)

# ---- Supabase config ----
SUPABASE_URL = 'https://dkszxyudruaqtlhininm.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrc3p4eXVkcnVhcXRsaGluaW5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODcwNzEsImV4cCI6MjA5MDk2MzA3MX0.mjtPxo0yvpPedV0vTlJ4qIZ5vOYHTnkGlfSR27yx4-U'
HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
}

# ---- Damage map ----
GRID_W = 96
GRID_H = 96
BRUSH_RADIUS = 4
DAMAGE_PER_PASS = 0.04
MAX_DAMAGE = 1.0

damage_map = [0.0] * (GRID_W * GRID_H)
interactions = 0
connected_clients = 0

_save_timer = None
_save_lock = threading.Lock()

# ---- Health check route (keeps Render warm) ----

@app.route('/health')
def health():
    return {'status': 'ok', 'interactions': interactions, 'connected': connected_clients}

# ---- Supabase I/O ----

def load_from_supabase():
    global damage_map, interactions
    try:
        res = requests.get(
            f'{SUPABASE_URL}/rest/v1/archive_state?id=eq.1&select=passes,damage_map',
            headers=HEADERS,
            timeout=8
        )
        data = res.json()
        if data:
            row = data[0]
            interactions = row.get('passes') or 0
            if row.get('damage_map'):
                damage_map = list(json.loads(row['damage_map']))
        print(f'Loaded from Supabase: {interactions} interactions')
    except Exception as e:
        print(f'Supabase load failed (starting fresh): {e}')

def save_to_supabase():
    try:
        requests.patch(
            f'{SUPABASE_URL}/rest/v1/archive_state?id=eq.1',
            headers=HEADERS,
            json={'passes': interactions, 'damage_map': json.dumps(damage_map)},
            timeout=8
        )
        print(f'Saved to Supabase: {interactions} interactions')
    except Exception as e:
        print(f'Supabase save failed: {e}')

def schedule_save():
    global _save_timer
    with _save_lock:
        if _save_timer:
            _save_timer.cancel()
        _save_timer = threading.Timer(2.0, save_to_supabase)
        _save_timer.start()

# ---- Damage logic ----

def apply_damage(gx, gy):
    for dy in range(-BRUSH_RADIUS, BRUSH_RADIUS + 1):
        for dx in range(-BRUSH_RADIUS, BRUSH_RADIUS + 1):
            dist = math.sqrt(dx * dx + dy * dy)
            if dist > BRUSH_RADIUS:
                continue
            nx, ny = gx + dx, gy + dy
            if nx < 0 or nx >= GRID_W or ny < 0 or ny >= GRID_H:
                continue
            idx = ny * GRID_W + nx
            damage_map[idx] = min(MAX_DAMAGE, damage_map[idx] + DAMAGE_PER_PASS * (1 - dist / BRUSH_RADIUS))

# ---- SocketIO events ----

@socketio.on('connect')
def on_connect():
    global connected_clients
    connected_clients += 1
    # Send full state to new client
    emit('init', {
        'damage_map': damage_map,
        'interactions': interactions,
        'connected': connected_clients
    })
    # Broadcast updated presence to everyone including new client
    socketio.emit('presence', {'connected': connected_clients})
    print(f'Client connected. Total: {connected_clients}')

@socketio.on('disconnect')
def on_disconnect():
    global connected_clients
    connected_clients = max(0, connected_clients - 1)
    socketio.emit('presence', {'connected': connected_clients})
    print(f'Client disconnected. Total: {connected_clients}')

@socketio.on('cursor_move')
def on_cursor_move(data):
    global interactions
    gx = int(data.get('gx', 0))
    gy = int(data.get('gy', 0))

    apply_damage(gx, gy)
    interactions += 1

    affected = []
    for dy in range(-BRUSH_RADIUS - 1, BRUSH_RADIUS + 2):
        for dx in range(-BRUSH_RADIUS - 1, BRUSH_RADIUS + 2):
            nx, ny = gx + dx, gy + dy
            if 0 <= nx < GRID_W and 0 <= ny < GRID_H:
                idx = ny * GRID_W + nx
                affected.append([idx, damage_map[idx]])

    emit('damage_update', {
        'affected': affected,
        'interactions': interactions,
        'gx': gx,
        'gy': gy
    }, broadcast=True)

    schedule_save()

@socketio.on('request_full_map')
def on_request_full_map():
    emit('init', {
        'damage_map': damage_map,
        'interactions': interactions,
        'connected': connected_clients
    })

# ---- Boot ----

if __name__ == '__main__':
    print('Loading state from Supabase...')
    load_from_supabase()
    print('Starting server...')
    socketio.run(app, host='0.0.0.0', port=5001, debug=False)