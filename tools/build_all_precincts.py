"""Build "All precincts.json.gz" (every precinct's walk turfs) straight from the county voter export.

    python3 tools/build_all_precincts.py 34_Ex-VotingHistory-....txt "All precincts.json.gz"

Districts (Congress, Oregon House, Oregon Senate) come from tools/precinct_districts.csv, taken from
the county's certified May 19, 2026 primary results (each precinct is listed under the US
Representative and State Representative contests it votes in). Senate district = (House + 1) // 2.

Targeting follows the precinct walk-list pages (sql/15_tiers.sql), checked against them:
- VoteRank (VR) = round(10 * YES / (YES + NO)); '-' means not eligible and is left out.
  A voter is "vested" (counted in the household average) with 4 or more opportunities.
- A household is one residential address, unit included. Confidential voters are never included.
- Tiers, in this order: U1 nobody vested · D1 Democrat, no Republican · XD mixed, Democrat leads ·
  XO mixed, Democrats outnumber · B1/B2 household AvgVR under the floor (2) · MT mixed, tied ·
  R3 mixed, Republican leads · R1 Republican · R2 IND/LBT/NLB, no Democrat · N1 everyone else.
- Walk: R1, R2, N1, R3. "Judge at the door" turfs: MT. Everything else is left off.
- Order: street name (ignoring the direction prefix), house number, unit. Turfs of 30 doors,
  broken at a street change, never more than 42 (same as the precinct pages).
- Rural precincts are marked "driving"; the original routed them by road, this orders them by street.
"""
import sys, re, json, gzip, math, csv, os, urllib.parse
from collections import defaultdict, Counter

LEAN = {'REP': 8, 'LBT': 7, 'IND': 6, 'NLB': 6, 'NAV': 5, 'OTH': 5, 'DEM': 2, 'PGP': 1, 'WFP': 1, 'PRO': 1}
FLOOR, TARGET, STOPS = 2, 30, 10
WALK, MARK = {'R1', 'R2', 'N1', 'R3'}, {'MT'}

def load(path):
    f = open(path, encoding='cp1252', newline='')          # cp1252, never UTF-8 (see the data guide)
    hdr = f.readline().rstrip('\r\n').split('\t')
    for line in f:
        c = line.rstrip('\r\n').split('\t')
        if len(c) != 65 or c[8] == 'ACP' or c[6] == 'Confidential': continue
        d = dict(zip(hdr[:40], c[:40])); h = c[40:]
        d['yes'], d['opp'] = h.count('YES'), h.count('YES') + h.count('NO')
        yield d

def vr(d): return math.floor(10 * d['yes'] / d['opp'] + 0.5) if d['opp'] else None
def street(d): return ' '.join(x for x in [d['PRE_DIRECTION'], d['STREET_NAME'], d['STREET_TYPE'], d['POST_DIRECTION']] if x)
def unit(d): return ' '.join(x for x in [d['UNIT_TYPE'], d['UNIT_NUM']] if x) or None
def house(d): return ' '.join(x for x in [d['HOUSE_NUM'], d['HOUSE_SUFFIX']] if x)
def fullname(d): return ' '.join(x for x in [d['FIRST_NAME'], d['LAST_NAME'], d['NAME_SUFFIX']] if x)
def primary(vs): return sorted(vs, key=lambda d: (vr(d) is None, -(vr(d) or 0), d['BIRTH_DATE'], int(d['VOTER_ID'])))[0]
def natkey(s): return [int(t) if t.isdigit() else t for t in re.split(r'(\d+)', s or '')]

def lead(g):
    v = [vr(d) for d in g if vr(d) is not None]
    return max(v) if v else -1

def tier(vs):
    vest = [d for d in vs if d['opp'] >= 4]
    R = [d for d in vs if d['PARTY_CODE'] == 'REP']; D = [d for d in vs if d['PARTY_CODE'] == 'DEM']
    rd = None
    if R and D: rd = 'RLED' if lead(R) > lead(D) else 'DLED' if lead(D) > lead(R) else 'TIED'
    if not vest: return 'U1'
    avg = sum(vr(d) for d in vest) / len(vest)
    if D and not R: return 'D1'
    if rd == 'DLED': return 'XD'
    if R and D and len(D) > len(R): return 'XO'
    if avg < FLOOR: return 'B2' if D else 'B1'
    if rd == 'TIED': return 'MT'
    if rd == 'RLED': return 'R3'
    if R: return 'R1'
    if any(LEAN.get(d['PARTY_CODE'], 5) > 5 for d in vs): return 'R2'
    return 'N1'

def nice(s):
    s = re.sub(r"(^|[^a-z0-9'])([a-z])", lambda m: m.group(1) + m.group(2).upper(), s.lower())
    return re.sub(r"\b(Nw|Sw|Ne|Se|Ii|Iii|Iv)\b", lambda m: m.group(0).upper(), s)

def cut(rows):
    cap = max(TARGET, min(120, round(TARGET * 1.4))); out, cur = [], []
    for i, r in enumerate(rows):
        cur.append(r); nx = rows[i + 1] if i + 1 < len(rows) else None
        if not nx: break
        if len(cur) >= cap or (len(cur) >= TARGET and nx['street'] != r['street']): out.append(cur); cur = []
    if cur: out.append(cur)
    return out

def turf_name(t):
    s = list(dict.fromkeys(r['street'] for r in t))
    return s[0] if len(s) == 1 else f"{s[0]} → {s[-1]} ({len(s)} streets)"

def order(k):
    u = (k[2] or '').split(' ', 1)[-1] if k[2] else ''
    return (re.sub(r'^(N|S|E|W|NE|NW|SE|SW) ', '', k[1]), k[1], natkey(k[0]), (len(u), u), k[2] or '')

def districts():
    f = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'precinct_districts.csv')
    return {r['precinct']: {k: int(r[k]) for k in ('cd', 'hd', 'sd')} for r in csv.DictReader(open(f))}

def build(path):
    dist = districts()
    groups, pname = defaultdict(lambda: defaultdict(list)), {}
    for d in load(path):
        if d['PRECINCT'] == '0000': continue
        p = f"{d['PRECINCT']}.{d['SPLIT']}"
        groups[p][(house(d), street(d), unit(d))].append(d); pname[p] = d['PRECINCT_NAME']
    packs = []
    for p in sorted(groups, key=natkey):
        H, walk, mark, cities = groups[p], [], [], Counter()
        for k in sorted(H, key=order):
            vs = H[k]; t = tier(vs)
            for d in vs: cities[(d['CITY'], d['ZIP_CODE'])] += 1
            if t not in WALK | MARK: continue
            pv, a = primary(vs), vs[0]
            row = {'addr': ' '.join(x for x in k if x), 'name': fullname(pv), 'hh': str(len(vs)), 'tier': t,
                   'phone': pv['PHONE_NUM'] if pv['UNLISTED'] != 'Yes' else '', 'street': k[1],
                   '_q': f"{k[0]} {k[1]}, {a['CITY'].title()}, OR {a['ZIP_CODE']}"}
            (walk if t in WALK else mark).append(row)
        if not walk and not mark: continue
        mode = 'driving' if 'RURAL' in pname[p].upper() else 'walking'
        turfs = []
        for chunk, label in [(c, '') for c in cut(walk)] + [(c, 'Judge at the door: ') for c in cut(mark)]:
            rows = [dict(r, n=i + 1, knock=True, map=i // STOPS + 1) for i, r in enumerate(chunk)]
            maps = []
            for m in range(0, len(rows), STOPS):
                seg = rows[m:m + STOPS]; q = {'api': '1', 'destination': seg[-1]['_q'], 'travelmode': mode}
                if m: q['origin'] = rows[m - 1]['_q']
                if len(seg) > 1: q['waypoints'] = '|'.join(x['_q'] for x in seg[:-1])
                ss = list(dict.fromkeys(x['street'] for x in seg))
                maps.append({'url': 'https://www.google.com/maps/dir/?' + urllib.parse.urlencode(q, quote_via=urllib.parse.quote),
                             'label': f"Map {m // STOPS + 1} · " + (nice(ss[0]) if len(ss) == 1 else f"{nice(ss[0])} → {nice(ss[-1])}")})
            turfs.append({'id': f"T{len(turfs) + 1}", 'name': label + turf_name(chunk), 'maps': maps,
                          'rows': [{k: r[k] for k in ['n', 'knock', 'addr', 'name', 'hh', 'tier', 'phone', 'street', 'map']} for r in rows]})
        (city, zp), _ = cities.most_common(1)[0]
        packs.append({'v': 1, 'title': f'Precinct {p}', 'mode': mode, 'area': f'{city.title()}, OR {zp}',
                      **dist.get(p, {}), 'turfCount': len(turfs), 'turfs': turfs})
    return packs

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'All precincts.json.gz'
    packs = build(src)
    with gzip.open(out, 'wb', compresslevel=9) as f: f.write(json.dumps({'packs': packs}, separators=(',', ':')).encode())
    print(out, len(packs), 'precincts', sum(len(x['turfs']) for x in packs), 'turfs',
          sum(len(t['rows']) for x in packs for t in x['turfs']), 'doors')
