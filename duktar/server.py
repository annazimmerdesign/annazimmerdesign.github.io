"""
server.py — Dukhtar, Dispossessed
Flask-SocketIO live damage layer + server-side databend image corruption.
"""

from flask import Flask, send_file, jsonify
from flask_socketio import SocketIO, emit
from flask_cors import CORS
from PIL import Image, ImageChops
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

SUPABASE_URL = 'https://dkszxyudruaqtlhininm.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrc3p4eXVkcnVhcXRsaGluaW5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODcwNzEsImV4cCI6MjA5MDk2MzA3MX0.mjtPxo0yvpPedV0vTlJ4qIZ5vOYHTnkGlfSR27yx4-U'
HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
}

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

bent_images = {}
MAX_BEND_PASSES = 20
bend_pass_counts = {}
last_bend_damage = {}

# staggered offsets — imperial images degrade first
IMAGE_OFFSETS = {
    'image1.jpg': 0,
    'image2.jpg': 200,
    'image3.jpg': 400,
    'image4.jpg': 100,
    'image5.jpg': 300,
}


# ---- Databend ----

def find_sos_offset(data: bytearray) -> int:
    i = 2
    while i < len(data) - 1:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker == 0xDA:
            if i + 3 < len(data):
                length = (data[i + 2] << 8) + data[i + 3]
                return i + 2 + length
        elif marker in range(0xE0, 0xF0) or marker in (0xDB, 0xC0, 0xC2, 0xC4, 0xC9, 0xCB):
            if i + 3 < len(data):
                length = (data[i + 2] << 8) + data[i + 3]
                i += 2 + length
                continue
        i += 1
    return max(500, len(data) // 5)


def databend(data: bytearray, intensity: float, seed: int) -> bytearray:
    """
    Two-phase permanent degradation triggered by user clicks.
    Phase 1: Pillow re-encoding (always) — authentic JPEG artifacts, no grey void.
    Phase 2 (intensity > 0.5): byte corruption on top for dramatic color effects.
    """
    rng = random.Random(seed)
    try:
        img = Image.open(io.BytesIO(bytes(data)))
        img = img.convert('RGB')
        w, h = img.size

        # phase 1: re-encoding
        quality = max(10, int(90 - intensity * 45))
        encode_passes = max(1, int(intensity * 3) + 1)
        for _ in range(encode_passes):
            buf = io.BytesIO()
            img.save(buf, format='JPEG', quality=quality)
            buf.seek(0)
            img = Image.open(buf)
            img = img.convert('RGB')

        # channel shift
        shift = int(intensity * 14)
        if shift > 0:
            r, g, b = img.split()
            r = ImageChops.offset(r, -shift, 0)
            b = ImageChops.offset(b, shift, 0)
            img = Image.merge('RGB', (r, g, b))

        # scanlines at mid-high intensity
        if intensity > 0.45:
            pixels = img.load()
            for _ in range(max(1, int(intensity * 6))):
                y = rng.randint(0, h - 1)
                color = (rng.choice([0,128,255]), rng.choice([0,128,255]), rng.choice([0,128,255]))
                for x in range(rng.randint(0, w//2), rng.randint(w//2, w)):
                    try: pixels[x, y] = color
                    except: pass

        out = io.BytesIO()
        img.save(out, format='JPEG', quality=max(15, quality - 5))
        result = bytearray(out.getvalue())

        # phase 2: byte corruption at higher intensity
        if intensity > 0.5:
            start = find_sos_offset(result)
            end = len(result) - 2
            data_len = end - start
            if data_len > 200:
                phase2 = (intensity - 0.5) * 2
                num_corruptions = max(2, int(data_len * phase2 * 0.0008))
                segment_size = data_len // num_corruptions
                for i in range(num_corruptions):
                    seg_start = start + i * segment_size
                    seg_end = min(end - 1, seg_start + segment_size)
                    if seg_start >= seg_end: continue
                    pos = rng.randint(seg_start, seg_end)
                    action = rng.random()
                    if action < 0.35:
                        result[pos] = rng.randint(0, 255)
                    elif action < 0.55:
                        result[pos] = result[max(start, pos - rng.randint(1, 60))]
                    elif action < 0.72:
                        run = rng.randint(4, 24)
                        val = rng.choice([0, 0, 128, 255, 255])
                        for j in range(run):
                            if pos + j < end: result[pos + j] = val
                    else:
                        run = rng.randint(16, 80)
                        val = rng.choice([0, 0, 255, 255, 192, 64])
                        for j in range(run):
                            if pos + j < end: result[pos + j] = val

        return result
    except Exception as e:
        print(f'Databend error: {e}')
        return data


def apply_bend_pass(filename: str):
    """Apply one databend pass to an image and broadcast to all clients."""
    if filename not in bent_images:
        return
    passes = bend_pass_counts.get(filename, 0)
    if passes >= MAX_BEND_PASSES:
        return

    intensity = 0.02 + (passes / MAX_BEND_PASSES) * 0.98
    seed = passes * 7919 + hash(filename) % 100000

    bent_images[filename] = databend(bent_images[filename], intensity, seed)
    bend_pass_counts[filename] = passes + 1

    print(f'Bent {filename}: pass {passes + 1}, intensity {intensity:.2f}')

    bent_b64 = base64.b64encode(bytes(bent_images[filename])).decode('utf-8')
    socketio.emit('image_update', {
        'filename': filename,
        'data': f'data:image/jpeg;base64,{bent_b64}',
        'passes': passes + 1,
    })
    save_bent_image_to_supabase(filename, bent_b64, passes + 1)


def maybe_bend_images():
    """Background accumulation — slow degradation from collective interactions."""
    for filename in list(bent_images.keys()):
        passes = bend_pass_counts.get(filename, 0)
        if passes >= MAX_BEND_PASSES:
            continue
        offset = IMAGE_OFFSETS.get(filename, 500)
        expected_passes = min(MAX_BEND_PASSES, max(0, (interactions - offset) // 1000))
        if passes >= expected_passes:
            continue
        apply_bend_pass(filename)


# ---- Supabase ----

def save_bent_image_to_supabase(filename: str, b64: str, passes: int):
    try:
        res = requests.get(
            f'{SUPABASE_URL}/rest/v1/image_state?filename=eq.{filename}&select=id',
            headers=HEADERS, timeout=8
        )
        existing = res.json()
        payload = {'filename': filename, 'image_data': b64, 'bend_passes': passes}
        if existing:
            requests.patch(f'{SUPABASE_URL}/rest/v1/image_state?filename=eq.{filename}',
                headers=HEADERS, json=payload, timeout=8)
        else:
            requests.post(f'{SUPABASE_URL}/rest/v1/image_state',
                headers=HEADERS, json=payload, timeout=8)
    except Exception as e:
        print(f'Failed to save bent image {filename}: {e}')


def load_bent_images_from_supabase():
    try:
        res = requests.get(
            f'{SUPABASE_URL}/rest/v1/image_state?select=filename,image_data,bend_passes',
            headers=HEADERS, timeout=8
        )
        for row in res.json():
            fn, b64, passes = row.get('filename'), row.get('image_data'), row.get('bend_passes', 0)
            if fn and b64:
                bent_images[fn] = bytearray(base64.b64decode(b64))
                bend_pass_counts[fn] = passes
                print(f'Loaded bent image {fn}: {passes} passes')
    except Exception as e:
        print(f'Failed to load bent images: {e}')


def get_image_bytes(filename: str):
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


def register_image(filename: str):
    if filename in bent_images:
        return
    original = get_image_bytes(filename)
    if original:
        bent_images[filename] = original
        bend_pass_counts[filename] = 0
        print(f'Registered: {filename}')
    else:
        print(f'Could not load: {filename}')


def get_average_damage():
    return sum(damage_map) / len(damage_map) if damage_map else 0.0


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


@app.route('/debug-images')
def debug_images():
    base = os.path.dirname(__file__)
    results = {}
    for name in ['image1.jpg','image2.jpg','image3.jpg','image4.jpg','image5.jpg']:
        for path in [os.path.join(base,'images',name), os.path.join(base,name)]:
            results[path] = os.path.exists(path)
    return jsonify(results)


# ---- Supabase damage map ----

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
                    print('Damage map size mismatch — starting fresh')
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


def apply_damage(gx, gy):
    for dy in range(-BRUSH_RADIUS, BRUSH_RADIUS + 1):
        for dx in range(-BRUSH_RADIUS, BRUSH_RADIUS + 1):
            dist = math.sqrt(dx*dx + dy*dy)
            if dist > BRUSH_RADIUS: continue
            nx, ny = gx + dx, gy + dy
            if nx < 0 or nx >= GRID_W or ny < 0 or ny >= GRID_H: continue
            idx = ny * GRID_W + nx
            damage_map[idx] = min(MAX_DAMAGE, damage_map[idx] + DAMAGE_PER_PASS * (1 - dist/BRUSH_RADIUS))


# ---- SocketIO events ----

@socketio.on('connect')
@socketio.on('connect')
def on_connect():
    global connected_clients
    connected_clients += 1
    emit('init', {
        'damage_map': damage_map,
        'interactions': interactions,
        'connected': connected_clients,
    })
    # tell client which images are available and at what pass count
    # client fetches via HTTP — no base64 over socket
    emit('images_ready', {
        'images': {k: v for k, v in bend_pass_counts.items()}
    })
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
    for dy in range(-BRUSH_RADIUS-1, BRUSH_RADIUS+2):
        for dx in range(-BRUSH_RADIUS-1, BRUSH_RADIUS+2):
            nx, ny = gx+dx, gy+dy
            if 0 <= nx < GRID_W and 0 <= ny < GRID_H:
                idx = ny * GRID_W + nx
                affected.append([idx, damage_map[idx]])

    emit('damage_update', {
        'affected': affected,
        'interactions': interactions,
        'gx': gx, 'gy': gy,
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
    filename = os.path.basename(data.get('filename', ''))
    if filename:
        register_image(filename)


@socketio.on('image_click')
def on_image_click(data):
    """
    User clicked an image — apply one permanent databend pass.
    Broadcast updated image to ALL current and future visitors.
    """
    filename = os.path.basename(data.get('filename', ''))
    if not filename:
        return
    if filename not in bent_images:
        register_image(filename)
    apply_bend_pass(filename)
    print(f'Image clicked: {filename} — bend pass applied')


@socketio.on('request_full_map')
def on_request_full_map():
    emit('init', {
        'damage_map': damage_map,
        'interactions': interactions,
        'connected': connected_clients,
    })



@socketio.on('node_move')
def on_node_move(data):
    """Broadcast node position to all visitors and persist to Supabase."""
    node_id = data.get('nodeId', '')
    x = data.get('x', 0)
    y = data.get('y', 0)
    if not node_id:
        return
    # broadcast to all other clients
    emit('node_moved', {'nodeId': node_id, 'x': x, 'y': y}, broadcast=True, include_self=False)
    # persist to Supabase
    try:
        key = f'node_pos_{node_id}'
        payload = {'key': key, 'value': json.dumps({'x': x, 'y': y})}
        res = requests.get(
            f'{SUPABASE_URL}/rest/v1/site_state?key=eq.{key}&select=id',
            headers=HEADERS, timeout=8
        )
        existing = res.json()
        if existing:
            requests.patch(
                f'{SUPABASE_URL}/rest/v1/site_state?key=eq.{key}',
                headers=HEADERS, json=payload, timeout=8
            )
        else:
            requests.post(
                f'{SUPABASE_URL}/rest/v1/site_state',
                headers=HEADERS, json=payload, timeout=8
            )
    except Exception as e:
        print(f'Failed to save node position: {e}')

# ---- Boot ----

if __name__ == '__main__':
    print('Loading state from Supabase...')
    load_from_supabase()
    load_bent_images_from_supabase()
    print('Starting server...')
    socketio.run(app, host='0.0.0.0', port=5009, debug=False)