"""
server.py — Dukhtar, Dispossessed
Flask-SocketIO live damage layer + server-side databend image corruption.
"""

from flask import Flask, send_file, jsonify
from flask_socketio import SocketIO, emit
from flask_cors import CORS
import json
import math
import random
import base64
import io
import os
import requests
import threading

app = Flask(__name__)
app.config['SECRET_KEY'] = 'dukhtar-secret-change-in-prod'
CORS(app)

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
GRID_W = 192
GRID_H = 192
BRUSH_RADIUS = 4
DAMAGE_PER_PASS = 0.15
MAX_DAMAGE = 1.0

damage_map = [0.0] * (GRID_W * GRID_H)
interactions = 0
connected_clients = 0

_save_timer = None
_save_lock = threading.Lock()

# ---- Databend image state ----
# Stores the current bent version of each image as raw bytes.
# Key: image filename (e.g. "image1.jpg")
# Value: bytearray of the current corrupted JPEG
bent_images = {}

# How many total databend passes before fully corrupted
MAX_BEND_PASSES = 60

# Track how many passes each image has had
bend_pass_counts = {}

# Damage threshold between bend passes — each 0.01 of average damage = 1 pass
BEND_DAMAGE_STEP = 0.005

# Last average damage level when we last bent each image
last_bend_damage = {}


# ---- Databend core ----

def databend(data: bytearray, intensity: float, seed: int) -> bytearray:
    """
    Corrupt JPEG bytes between header and EOI marker.
    Intensity 0.0-1.0 controls corruption amount.
    Includes occasional dramatic color channel shifts.
    """
    result = bytearray(data)
    start = min(500, len(result) // 4)
    end = len(result) - 2

    if end <= start:
        return result

    rng = random.Random(seed)
    num_corruptions = max(1, int((end - start) * intensity * 0.015))

    for _ in range(num_corruptions):
        pos = rng.randint(start, end)
        action = rng.random()

        if action < 0.25:
            # random byte
            result[pos] = rng.randint(0, 255)
        elif action < 0.45:
            # smear from nearby
            src = max(start, pos - rng.randint(1, 100))
            result[pos] = result[src]
        elif action < 0.58:
            # zero out
            result[pos] = 0
        elif action < 0.70:
            # flip bits
            result[pos] ^= 0xFF
        elif action < 0.83:
            # horizontal band — variable length
            run = rng.randint(8, 60)
            val = rng.randint(0, 255)
            for j in range(run):
                if pos + j < end:
                    result[pos + j] = val
        elif action < 0.92:
            # DRAMATIC: corrupt a large block with max/min values
            # creates the magenta/cyan color channel explosions
            run = rng.randint(50, 200)
            val = rng.choice([0, 0, 0, 255, 255, 128, 192])
            for j in range(run):
                if pos + j < end:
                    result[pos + j] = val
        else:
            # DRAMATIC: swap a chunk to a distant location
            # creates the characteristic color smear/echo artifacts
            src = rng.randint(start, max(start, end - 100))
            run = rng.randint(20, 80)
            for j in range(run):
                if pos + j < end and src + j < end:
                    result[pos + j] = result[src + j]

    return result


def get_image_bytes(filename: str) -> bytearray | None:
    """Load original image from disk."""
    # Try relative to server.py location
    paths = [
        os.path.join(os.path.dirname(__file__), 'images', filename),
        os.path.join(os.path.dirname(__file__), filename),
        os.path.join('images', filename),
        filename,
    ]
    for path in paths:
        if os.path.exists(path):
            with open(path, 'rb') as f:
                return bytearray(f.read())
    return None


def get_average_damage() -> float:
    """Get mean damage across the whole map."""
    if not damage_map:
        return 0.0
    return sum(damage_map) / len(damage_map)


def maybe_bend_images():
    for filename in list(bent_images.keys()):
        passes = bend_pass_counts.get(filename, 0)
        if passes >= MAX_BEND_PASSES:
            continue
        
        # trigger a new pass every 50 interactions
        expected_passes = min(MAX_BEND_PASSES, interactions // 100)
        if passes >= expected_passes:
            continue
        
        intensity = 0.5 + (passes / MAX_BEND_PASSES) * 0.5
        seed = passes * 7919 + hash(filename) % 100000
        
        bent_images[filename] = databend(bent_images[filename], intensity, seed)
        bend_pass_counts[filename] = passes + 1
        
        print(f'Bent {filename}: pass {passes + 1}')
        
        bent_b64 = base64.b64encode(bytes(bent_images[filename])).decode('utf-8')
        socketio.emit('image_update', {
            'filename': filename,
            'data': f'data:image/jpeg;base64,{bent_b64}',
            'passes': passes + 1,
        })
        save_bent_image_to_supabase(filename, bent_b64, passes + 1)


def save_bent_image_to_supabase(filename: str, b64: str, passes: int):
    """Save bent image state to Supabase image_state table."""
    try:
        # check if row exists
        res = requests.get(
            f'{SUPABASE_URL}/rest/v1/image_state?filename=eq.{filename}&select=id',
            headers=HEADERS, timeout=8
        )
        existing = res.json()
        
        payload = {
            'filename': filename,
            'image_data': b64,
            'bend_passes': passes,
        }
        
        if existing:
            requests.patch(
                f'{SUPABASE_URL}/rest/v1/image_state?filename=eq.{filename}',
                headers=HEADERS, json=payload, timeout=8
            )
        else:
            requests.post(
                f'{SUPABASE_URL}/rest/v1/image_state',
                headers=HEADERS, json=payload, timeout=8
            )
    except Exception as e:
        print(f'Failed to save bent image {filename}: {e}')


def load_bent_images_from_supabase():
    """Load previously bent image states from Supabase on boot."""
    try:
        res = requests.get(
            f'{SUPABASE_URL}/rest/v1/image_state?select=filename,image_data,bend_passes',
            headers=HEADERS, timeout=8
        )
        rows = res.json()
        for row in rows:
            fn = row.get('filename')
            b64 = row.get('image_data')
            passes = row.get('bend_passes', 0)
            if fn and b64:
                bent_images[fn] = bytearray(base64.b64decode(b64))
                bend_pass_counts[fn] = passes
                print(f'Loaded bent image {fn}: {passes} passes')
    except Exception as e:
        print(f'Failed to load bent images: {e}')

def register_image(filename: str):
    if filename in bent_images:
        return
    original = get_image_bytes(filename)
    if original:
        # apply accumulated bending up to current state in one shot
        current_expected = min(MAX_BEND_PASSES, interactions // 200)
        data = bytearray(original)
        for p in range(current_expected):
            intensity = 0.3 + (p / MAX_BEND_PASSES) * 0.7
            seed = p * 7919 + hash(filename) % 100000
            data = databend(data, intensity, seed)
        bent_images[filename] = data
        bend_pass_counts[filename] = current_expected
        print(f'Registered {filename}: applied {current_expected} passes to match current state')
    else:
        print(f'Could not load image for databending: {filename}')


# ---- HTTP routes ----

@app.route('/health')
def health():
    return jsonify({
        'status': 'ok',
        'interactions': interactions,
        'connected': connected_clients,
        'avg_damage': round(get_average_damage(), 4),
        'bent_images': {k: v for k, v in bend_pass_counts.items()},
    })


@app.route('/image/<filename>')
def serve_image(filename):
    """Serve the current bent version of an image."""
    # sanitize filename
    filename = os.path.basename(filename)
    
    if filename not in bent_images:
        register_image(filename)
    
    if filename in bent_images:
        img_bytes = bytes(bent_images[filename])
        return send_file(
            io.BytesIO(img_bytes),
            mimetype='image/jpeg',
            as_attachment=False,
        )
    
    return jsonify({'error': 'image not found'}), 404


@app.route('/register/<filename>')
def register_endpoint(filename):
    """Register an image for databending."""
    filename = os.path.basename(filename)
    register_image(filename)
    return jsonify({'registered': filename, 'passes': bend_pass_counts.get(filename, 0)})


# ---- Supabase I/O ----

def load_from_supabase():
    global damage_map, interactions
    try:
        res = requests.get(
            f'{SUPABASE_URL}/rest/v1/archive_state?id=eq.1&select=passes,damage_map',
            headers=HEADERS, timeout=8
        )
        data = res.json()
        if data:
            row = data[0]
            interactions = row.get('passes') or 0
            if row.get('damage_map'):
                loaded = list(json.loads(row['damage_map']))
                if len(loaded) == GRID_W * GRID_H:
                    damage_map = loaded
                else:
                    print(f'Damage map size mismatch — starting fresh')
        print(f'Loaded from Supabase: {interactions} interactions')
    except Exception as e:
        print(f'Supabase load failed: {e}')


def save_to_supabase():
    try:
        requests.patch(
            f'{SUPABASE_URL}/rest/v1/archive_state?id=eq.1',
            headers=HEADERS,
            json={'passes': interactions, 'damage_map': json.dumps(damage_map)},
            timeout=8
        )
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
    emit('init', {
        'damage_map': damage_map,
        'interactions': interactions,
        'connected': connected_clients,
    })
    # send current bent images to new client
    for filename, data in bent_images.items():
        b64 = base64.b64encode(bytes(data)).decode('utf-8')
        emit('image_update', {
            'filename': filename,
            'data': f'data:image/jpeg;base64,{b64}',
            'passes': bend_pass_counts.get(filename, 0),
        })
    print(f'Current bent images: {list(bent_images.keys())}')
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
        'gy': gy,
    }, broadcast=True)

    schedule_save()
    maybe_bend_images()


@socketio.on('cursor_position')
def on_cursor_position(data):
    from flask import request
    emit('remote_cursor', {
        'id': request.sid,
        'nx': data.get('nx', 0),
        'ny': data.get('ny', 0),
    }, broadcast=True, include_self=False)


@socketio.on('register_image')
def on_register_image(data):
    """Client tells server which images to track for databending."""
    filename = os.path.basename(data.get('filename', ''))
    if filename:
        register_image(filename)


@socketio.on('request_bent_image')
def on_request_bent_image(data):
    """Client requests current bent state of a specific image."""
    filename = os.path.basename(data.get('filename', ''))
    if not filename:
        return
    if filename not in bent_images:
        register_image(filename)
    if filename in bent_images:
        b64 = base64.b64encode(bytes(bent_images[filename])).decode('utf-8')
        emit('image_update', {
            'filename': filename,
            'data': f'data:image/jpeg;base64,{b64}',
            'passes': bend_pass_counts.get(filename, 0),
        })


@socketio.on('request_full_map')
def on_request_full_map():
    emit('init', {
        'damage_map': damage_map,
        'interactions': interactions,
        'connected': connected_clients,
    })


# ---- Boot ----

if __name__ == '__main__':
    print('Loading state from Supabase...')
    load_from_supabase()
    load_bent_images_from_supabase()
    print('Starting server...')
    socketio.run(app, host='0.0.0.0', port=5009, debug=False)



@app.route('/debug-images')

def debug_images():
    import os
    base = os.path.dirname(__file__)
    results = {}
    for name in ['image1.jpg', 'image2.jpg', 'image3.jpg']:
        for path in [
            os.path.join(base, 'images', name),
            os.path.join(base, name),
        ]:
            results[path] = os.path.exists(path)
    return jsonify(results)