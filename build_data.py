# Is script se records.json ko password ke sath encrypt karke data.enc.js banta hai.
# Istemal:  python build_data.py "apna-password"
# Nateeja:  ../police-record-search/data.enc.js  (sirf yahi file GitHub par jati hai)
import json, re, sys, gzip, os, base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ITER = 600000
FIELDS = ['sno','name','father','cnic','fir','date','sections','caseStatus','accusedStatus','statusDate','nominee','phone','src']

def clean_date(s): return re.sub(r'-\s+', '-', (s or '').strip())
def clean_cnic(s): return re.sub(r'\s+', '', (s or '').strip())
def clean_sections(s):
    s = (s or '').strip()
    parts = re.split(r',(?=[A-Za-z]{3})', s)
    seen = []
    for p in parts:
        p = p.strip()
        if p and p not in seen: seen.append(p)
    return ','.join(seen)

def compact(rows):
    out = []
    for r in rows:
        out.append([
            int(r['sno']), r.get('name',''), r.get('father',''), clean_cnic(r.get('cnic','')), r.get('fir',''),
            clean_date(r.get('date','')), clean_sections(r.get('sections','')), r.get('case_status',''),
            r.get('accused_status',''), clean_date(r.get('cur_status_date','')), r.get('nominee_type',''),
            re.sub(r'\s+','',r.get('phone','') or ''), f"{r['file']}-{r['page']}"
        ])
    return out

def main():
    if len(sys.argv) < 2:
        print('Password dein:  python build_data.py "apna-password"'); sys.exit(1)
    pw = sys.argv[1]
    here = os.path.dirname(os.path.abspath(__file__))
    rows = json.load(open(os.path.join(here, 'records.json'), encoding='utf-8'))
    payload = json.dumps({'fields': FIELDS, 'rows': compact(rows)}, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    comp = gzip.compress(payload, 9)
    salt = os.urandom(16); iv = os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(pw.encode('utf-8'))
    ct = AESGCM(key).encrypt(iv, comp, None)
    blob = base64.b64encode(salt + iv + ct).decode('ascii')
    dest = os.path.join(here, '..', 'police-record-search', 'data.enc.js')
    with open(dest, 'w', encoding='ascii') as f:
        f.write('window.ENC_DATA={"iter":%d,"gz":true,"blob":"%s"};\n' % (ITER, blob))
    print('rows:', len(rows), '| plain bytes:', len(payload), '| file:', os.path.getsize(dest))

main()
