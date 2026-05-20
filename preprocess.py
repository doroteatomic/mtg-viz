#!/usr/bin/env python3
"""
MTG Data Preprocessor
Generates D3-ready JSON files from three Kaggle datasets.
"""

import zipfile, json, csv, io, re, os, sys
from collections import defaultdict, Counter
from datetime import datetime

DOWNLOADS = "D:/Users/Korisnik/Downloads"
OUTPUT_DIR = "C:/Users/Korisnik/mtg-viz/data"
COLORS = ['W', 'U', 'B', 'R', 'G']
COLOR_NAMES = {'W': 'White', 'U': 'Blue', 'B': 'Black', 'R': 'Red', 'G': 'Green'}

def parse_color_list(s):
    if not s or str(s).strip() in ('[]', '', 'nan'):
        return []
    return re.findall(r"'([WUBRG])'", str(s))

def colors_to_identity(colors):
    if not colors:
        return 'C'
    filtered = [c for c in COLORS if c in colors]
    return ''.join(filtered) if filtered else 'C'

def progress(msg):
    print(f"  {msg}", flush=True)

os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── 1. Build card name → colors lookup from all_mtg_cards.csv ─────────────────
print("\n[1/5] Building card color lookup (streaming 356MB CSV)...")
card_colors = {}
count = 0
with zipfile.ZipFile(f"{DOWNLOADS}/archive.zip") as z:
    with z.open("all_mtg_cards.csv") as raw:
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8', errors='replace'))
        for row in reader:
            name = row.get('name', '').strip()
            colors = parse_color_list(row.get('colors', ''))
            count += 1
            if count % 100000 == 0:
                progress(f"{count:,} rows processed, {len(card_colors):,} unique cards...")
            if name and name not in card_colors:
                card_colors[name] = colors
progress(f"Done — {len(card_colors):,} unique cards in lookup")

# ── 2. Process competitive events + deck JSONs ─────────────────────────────────
print("\n[2/5] Processing competitive events and decks...")
meta_info = {}
event_map = {}
deck_records = []
card_freq = Counter()
deck_count = 0

with zipfile.ZipFile(f"{DOWNLOADS}/archive (2).zip") as z:
    # Load meta periods
    with z.open("df_meta.csv") as f:
        for row in csv.DictReader(io.TextIOWrapper(f, encoding='utf-8')):
            meta_info[int(row['meta_id'])] = row['meta_name']

    # Load events
    with z.open("df_events_v2.csv") as f:
        for row in csv.DictReader(io.TextIOWrapper(f, encoding='utf-8')):
            eid = int(row['event__id'])
            event_map[eid] = {
                'meta_id': int(row['event_meta_id']),
                'date': row['event_date'],
                'stars': int(row['event_stars']),
                'bigstars': int(row['event_bigstars'])
            }

    # Process all deck JSONs
    all_entries = [e for e in z.infolist() if e.filename.endswith('_deck.json')]
    progress(f"Found {len(all_entries):,} deck JSON files")

    for entry in all_entries:
        parts = entry.filename.split('/')
        if len(parts) < 3:
            continue
        try:
            event_id = int(parts[1])
        except ValueError:
            continue
        event = event_map.get(event_id, {})

        try:
            with z.open(entry) as f:
                deck = json.load(f)

            # Deduplicate cards (some JSONs have duplicates)
            cards = {}
            for card, count in deck.get('main_deck', []):
                cards[card] = int(count)

            # Determine deck color identity
            deck_color_set = set()
            for card_name in cards:
                deck_color_set.update(card_colors.get(card_name, []))
            colors = [c for c in COLORS if c in deck_color_set]
            identity = colors_to_identity(colors)

            # Track individual card frequencies
            for card_name in cards:
                card_freq[card_name] += 1

            deck_records.append({
                'event_id': event_id,
                'meta_id': event.get('meta_id', 0),
                'date': event.get('date', ''),
                'stars': event.get('stars', 0),
                'result': str(deck.get('result', '')),
                'player': deck.get('player', ''),
                'identity': identity,
                'colors': colors
            })
            deck_count += 1
        except Exception:
            pass

progress(f"Processed {deck_count:,} decks from {len(event_map):,} events")

# ── 3. Meta evolution (color distribution per Standard period) ─────────────────
print("\n[3/5] Building meta evolution data...")
meta_evo = []
# Sort metas by ID so they're roughly chronological
for mid, mname in sorted(meta_info.items(), key=lambda x: x[0]):
    mdecks = [d for d in deck_records if d['meta_id'] == mid]
    if len(mdecks) < 5:
        continue
    counts = Counter(d['identity'] for d in mdecks)
    total = len(mdecks)
    meta_evo.append({
        'meta_id': mid,
        'meta_name': mname,
        'total': total,
        'colors': [
            {'id': k, 'count': v, 'pct': round(v / total * 100, 1)}
            for k, v in counts.most_common(20)
        ]
    })
progress(f"{len(meta_evo)} meta periods")
with open(f"{OUTPUT_DIR}/meta_evolution.json", 'w', encoding='utf-8') as f:
    json.dump(meta_evo, f)

# ── 4. Color co-occurrence matrix (for chord diagram) ─────────────────────────
print("\n[4/5] Building color matrices...")
matrix = [[0] * 5 for _ in range(5)]
mono_counts = Counter()
for deck in deck_records:
    for i, c1 in enumerate(COLORS):
        if c1 in deck['colors']:
            for j, c2 in enumerate(COLORS):
                if c2 in deck['colors']:
                    matrix[i][j] += 1
    # Track mono-color for reference
    if len(deck['colors']) == 1:
        mono_counts[deck['colors'][0]] += 1

with open(f"{OUTPUT_DIR}/color_matrix.json", 'w', encoding='utf-8') as f:
    json.dump({
        'matrix': matrix,
        'colors': COLORS,
        'names': COLOR_NAMES,
        'mono': {c: mono_counts[c] for c in COLORS}
    }, f)
progress("color_matrix.json written")

# Monthly timeline for animation
monthly = defaultdict(Counter)
for deck in deck_records:
    try:
        d = datetime.strptime(deck['date'], '%d/%m/%y')
        monthly[d.strftime('%Y-%m')][deck['identity']] += 1
    except Exception:
        pass

timeline = [
    {
        'month': m,
        'colors': [{'id': k, 'count': v} for k, v in cnt.most_common(12)]
    }
    for m, cnt in sorted(monthly.items())
]
with open(f"{OUTPUT_DIR}/timeline.json", 'w', encoding='utf-8') as f:
    json.dump(timeline, f)
progress(f"timeline.json: {len(timeline)} months")

# ── 5. OTJ draft ratings ───────────────────────────────────────────────────────
print("\n[5/5] Processing OTJ draft ratings...")

def sf(s):
    try:
        return float(str(s).replace('%', '').replace('pp', '').strip())
    except Exception:
        return None

otj = []
with zipfile.ZipFile(f"{DOWNLOADS}/archive (1).zip") as z:
    with z.open("MTG-OTJ-draft-card-ratings-2024-05-25.csv") as f:
        for row in csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig')):
            gih = sf(row.get('GIH WR'))
            alsa = sf(row.get('ALSA'))
            if gih is None or alsa is None:
                continue
            otj.append({
                'name': row.get('Name', ''),
                'color': row.get('Color', ''),
                'rarity': row.get('Rarity', ''),
                'alsa': alsa,
                'gih_wr': gih,
                'gp_pct': sf(row.get('% GP')) or 0,
                'iwd': sf(row.get('IWD')) or 0,
                'num_seen': int(row.get('# Seen', '0') or 0),
                'num_gp': int(row.get('# GP', '0') or 0)
            })

with open(f"{OUTPUT_DIR}/otj_ratings.json", 'w', encoding='utf-8') as f:
    json.dump(otj, f)
progress(f"{len(otj)} OTJ cards with ratings")

# Top competitive cards
top_comp = []
for card_name, freq in card_freq.most_common(80):
    colors = card_colors.get(card_name, [])
    top_comp.append({
        'name': card_name,
        'colors': [c for c in COLORS if c in colors],
        'identity': colors_to_identity(colors),
        'freq': freq
    })
with open(f"{OUTPUT_DIR}/top_competitive.json", 'w', encoding='utf-8') as f:
    json.dump(top_comp, f)
progress(f"top_competitive.json: {len(top_comp)} cards")

print("\n✓ All preprocessing complete! Files saved to:", OUTPUT_DIR)
