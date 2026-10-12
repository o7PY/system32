#!/usr/bin/env python3
"""Writes tiny.glb: a valid one-triangle glTF 2.0 binary (~0.6 KB). A fixture for the sandbox/CORS test, not a game asset."""
import json
import struct
from pathlib import Path

positions = struct.pack('<9f', 0, 0, 0, 1, 0, 0, 0, 1, 0)
doc = {
    'asset': {'version': '2.0', 'generator': 'System32 test fixture'},
    'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}],
    'meshes': [{'primitives': [{'attributes': {'POSITION': 0}}]}],
    'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 3, 'type': 'VEC3', 'min': [0, 0, 0], 'max': [1, 1, 0]}],
    'bufferViews': [{'buffer': 0, 'byteLength': len(positions), 'target': 34962}],
    'buffers': [{'byteLength': len(positions)}],
}
js = json.dumps(doc, separators=(',', ':')).encode()
js += b' ' * (-len(js) % 4)                       # chunks are 4-byte aligned; JSON pads with spaces
chunks = struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(positions), 0x004E4942) + positions
Path(__file__).with_name('tiny.glb').write_bytes(struct.pack('<4sII', b'glTF', 2, 12 + len(chunks)) + chunks)
