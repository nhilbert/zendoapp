#!/usr/bin/env python3
"""
Recover Zendo browser data from a Chromium/Edge "Local Storage/leveldb" folder (or from
undeleted .ldb/.log files copied into any folder). Reads only; writes candidate-N.json
exports into the output folder, which Settings -> Import JSON (or PUT /api/state) can load.

  python3 -I scripts/recover-localstorage.py <folder with leveldb files> <output folder>
"""
import os, re, sys, json, struct, glob
SRC = sys.argv[1]
OUT = sys.argv[2]

def snappy_decompress(buf):
    pos = 0; out = bytearray()
    # preamble: varint uncompressed length
    shift = 0; n = 0
    while True:
        b = buf[pos]; pos += 1
        n |= (b & 0x7f) << shift
        if not (b & 0x80): break
        shift += 7
    while pos < len(buf):
        tag = buf[pos]; pos += 1
        t = tag & 3
        if t == 0:
            ln = tag >> 2
            if ln >= 60:
                extra = ln - 59
                ln = int.from_bytes(buf[pos:pos+extra], 'little'); pos += extra
            ln += 1
            out += buf[pos:pos+ln]; pos += ln
        else:
            if t == 1:
                ln = 4 + ((tag >> 2) & 7); off = ((tag >> 5) << 8) | buf[pos]; pos += 1
            elif t == 2:
                ln = (tag >> 2) + 1; off = int.from_bytes(buf[pos:pos+2], 'little'); pos += 2
            else:
                ln = (tag >> 2) + 1; off = int.from_bytes(buf[pos:pos+4], 'little'); pos += 4
            start = len(out) - off
            for i in range(ln): out.append(out[start + i])
    return bytes(out)

def ldb_blocks(data):
    """Yield decompressed data blocks of a LevelDB table file (best effort)."""
    if len(data) < 48: return
    footer = data[-48:]
    if footer[-8:] != b'\x57\xfb\x80\x8b\x24\x75\x47\xdb': return
    def varint(b, p):
        shift = 0; n = 0
        while True:
            x = b[p]; p += 1; n |= (x & 0x7f) << shift
            if not (x & 0x80): return n, p
            shift += 7
    p = 0
    _, p = varint(footer, p); _, p = varint(footer, p)   # metaindex handle
    ioff, p = varint(footer, p); isize, p = varint(footer, p)  # index handle
    def read_block(off, size):
        raw = data[off:off+size]; typ = data[off+size]
        return snappy_decompress(raw) if typ == 1 else raw
    try:
        index = read_block(ioff, isize)
    except Exception:
        return
    # parse index block entries: shared/unshared/value_len + key + value(handle)
    restarts = int.from_bytes(index[-4:], 'little')
    end = len(index) - 4 - 4 * restarts
    q = 0; key = b''
    while q < end:
        shared, q = varint(index, q); unshared, q = varint(index, q); vlen, q = varint(index, q)
        key = key[:shared] + index[q:q+unshared]; q += unshared
        handle = index[q:q+vlen]; q += vlen
        off, r = varint(handle, 0); size, r = varint(handle, r)
        try:
            yield read_block(off, size)
        except Exception:
            continue

def extract_json(text, start):
    """From text[start] == '{', return the balanced JSON object string."""
    depth = 0; i = start; instr = False; esc = False
    while i < len(text):
        ch = text[i]
        if instr:
            if esc: esc = False
            elif ch == '\\': esc = True
            elif ch == '"': instr = False
        else:
            if ch == '"': instr = True
            elif ch == '{': depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0: return text[start:i+1]
        i += 1
    return None

found = []
def scan_bytes(blob, label):
    # UTF-16LE and latin-1 variants of the persisted shape {"state":{"inbox"
    for enc, pat in (('utf-16-le', '{"state":{'.encode('utf-16-le')), ('latin-1', b'{"state":{')):
        for m in re.finditer(re.escape(pat), blob):
            s = m.start()
            chunk = blob[s:s + 4_000_000]
            if enc == 'utf-16-le' and len(chunk) % 2: chunk = chunk[:-1]
            try:
                text = chunk.decode(enc, errors='replace')
            except Exception:
                continue
            js = extract_json(text, 0)
            if not js: continue
            try:
                obj = json.loads(js)
            except Exception:
                continue
            st = obj.get('state', {})
            if not isinstance(st, dict) or 'tasks' not in st: continue
            found.append((label, enc, s, obj))

for f in sorted(glob.glob(os.path.join(SRC, '*'))):
    data = open(f, 'rb').read()
    name = os.path.basename(f)
    if name.endswith('.ldb'):
        for i, block in enumerate(ldb_blocks(data)):
            scan_bytes(block, f'{name}#block{i}')
    scan_bytes(data, name)

SAMPLE = {'Strategy workshop Northwind','Strategieworkshop Nordwind','Team development Musterstadt utilities','Teamentwicklung Stadtwerke Musterstadt','Leadership programme concept','Konzept Führungskräfteprogramm','Website relaunch','Website-Relaunch','Keynote at the November conference','Keynote auf der November-Konferenz','Offsite 2025 (done)','Offsite 2025 (erledigt)','Clear out the garage','Garage ausmisten'}
os.makedirs(OUT, exist_ok=True)
seen = set()
rows = []
for label, enc, off, obj in found:
    st = obj['state']
    key = json.dumps(st, sort_keys=True)[:20000]
    h = hash(json.dumps(st, sort_keys=True))
    if h in seen: continue
    seen.add(h)
    projects = st.get('projects', []); tasks = st.get('tasks', [])
    own = [p for p in projects if p.get('name') not in SAMPLE]
    latest = max([t.get('updatedAt','') for t in tasks] + [p.get('updatedAt','') for p in projects] + [''])
    idx = len(rows)
    out = os.path.join(OUT, f'candidate-{idx}.json')
    snap = {'version': obj.get('version', 4), 'exportedAt': latest, **{k: st.get(k, []) for k in ('inbox','projects','tasks','events','blocks','reviews')}, 'settings': st.get('settings')}
    json.dump(snap, open(out, 'w'), ensure_ascii=False)
    rows.append((idx, label, enc, len(projects), len(own), len(tasks), len(st.get('inbox', [])), len(st.get('events', [])), latest))
print(f'{len(found)} state records scanned, {len(rows)} distinct')
print('idx | source | enc | projects (own) | tasks | inbox | events | latest updatedAt')
for r in rows:
    print(f'{r[0]:>3} | {r[1]} | {r[2]} | {r[3]} ({r[4]}) | {r[5]} | {r[6]} | {r[7]} | {r[8]}')
