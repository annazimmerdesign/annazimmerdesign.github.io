"""
server.py — Dukhtar, Dispossessed
Flask-SocketIO live damage layer.

Responsibilities:
- Holds the damage map in memory for real-time broadcasting
- Receives cursor move events from clients, updates damage, broadcasts to all
- Syncs with Supabase on load (reads persisted state) and periodically on write
- Does NOT replace Supabase — Supabase is the persistent backing store,
  this server handles the live layer only

Deploy: PythonAnywhere (free tier, gevent worker)
Local:  python server.py  →  http://localhost:5000
"""

from flask import Flask
from flask_socketio import SocketIO, emit
import json
import math
import requests
import os
import time
import threading

app = Flask(__name__)
app.config['SECRET_KEY'] = 'dukhtar-secret-change-in-prod'

# Allow GitHub Pages origin + localhost for dev
# Update ALLOWED_ORIGINS with your actual GitHub Pages URL
ALLOWED_ORIGINS = [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:3000",
    # Add your GitHub Pages URL here, e.g.:
    # "https://annazimmerdesign.github.io",
]

socketio = SocketIO(
    app,
    cors_allowed_origins=ALLOWED_ORIGINS,
    async_mode='gevent',         # required for PythonAnywhere free tier
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

# Supabase save debounce
_save_timer = None
_save_lock = threading.Lock()

# ---- Supabase I/O ----

def load_from_supabase():
    """Load persisted damage map and interaction count from Supabase on boot."""
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
                loaded = json.loads(row['damage_map'])
                damage_map = list(loaded)
        print(f'Loaded from Supabase: {interactions} interactions')
    except Exception as e:
        print(f'Supabase load failed (starting fresh): {e}')


def save_to_supabase():
    """Persist current damage map and interaction count to Supabase."""
    try:
        requests.patch(
            f'{SUPABASE_URL}/rest/v1/archive_state?id=eq.1',
            headers=HEADERS,
            json={
                'passes': interactions,
                'damage_map': json.dumps(damage_map),
            },
            timeout=8
        )
        print(f'Saved to Supabase: {interactions} interactions')
    except Exception as e:
        print(f'Supabase save failed: {e}')


def schedule_save():
    """Debounced Supabase save — waits 2s after last interaction."""
    global _save_timer
    with _save_lock:
        if _save_timer:
            _save_timer.cancel()
        _save_timer = threading.Timer(2.0, save_to_supabase)
        _save_timer.start()


# ---- Damage logic ----

def apply_damage(gx, gy):
    """Apply brush damage around grid cell (gx, gy)."""
    for dy in range(-BRUSH_RADIUS, BRUSH_RADIUS + 1):
        for dx in range(-BRUSH_RADIUS, BRUSH_RADIUS + 1):
            dist = math.sqrt(dx * dx + dy * dy)
            if dist > BRUSH_RADIUS:
                continue
            nx, ny = gx + dx, gy + dy
            if nx < 0 or nx >= GRID_W or ny < 0 or ny >= GRID_H:
                continue
            idx = ny * GRID_W + nx
            falloff = 1 - dist / BRUSH_RADIUS
            damage_map[idx] = min(MAX_DAMAGE, damage_map[idx] + DAMAGE_PER_PASS * falloff)


def get_damage_at(gx, gy):
    gx = max(0, min(GRID_W - 1, gx))
    gy = max(0, min(GRID_H - 1, gy))
    return damage_map[gy * GRID_W + gx]


# ---- SocketIO events ----

@socketio.on('connect')
def on_connect():
    global connected_clients
    connected_clients += 1
    # Send current state to the newly connected client
    emit('init', {
        'damage_map': damage_map,
        'interactions': interactions,
        'connected': connected_clients
    })
    # Tell everyone else someone joined
    socketio.emit('presence', {'connected': connected_clients})
    print(f'Client connected. Total: {connected_clients}')


@socketio.on('disconnect')
def on_disconnect():
    global connected_clients
    connected_clients = max(0, connected_clients - 1)
    emit('presence', {'connected': connected_clients}, broadcast=True)
    print(f'Client disconnected. Total: {connected_clients}')


@socketio.on('cursor_move')
def on_cursor_move(data):
    """
    Receive cursor grid position from a client.
    data: { gx: int, gy: int }
    Apply damage, increment interactions, broadcast updated state.
    """
    global interactions
    gx = int(data.get('gx', 0))
    gy = int(data.get('gy', 0))

    apply_damage(gx, gy)
    interactions += 1

    # Broadcast the damage update to ALL clients (including sender)
    # Send only the affected region rather than the full map for efficiency
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
    """Client can request the full damage map (e.g. after reconnect)."""
    emit('init', {
        'damage_map': damage_map,
        'interactions': interactions,
        'connected': connected_clients
    })


# ---- Boot ----

if __name__ == '__main__':
    print('Loading state from Supabase...')
    load_from_supabase()
    print(f'Starting server...')
    socketio.run(app, host='0.0.0.0', port=5009, debug=True)