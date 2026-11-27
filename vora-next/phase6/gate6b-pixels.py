# เทียบภาพ ก่อน/หลัง ทีละหน้า: สัดส่วนพิกเซลที่ต่าง (ช่องสีต่าง > 8 ระดับ) — เกณฑ์ 6B-AC1 ≤ 0.1%
import sys, os, json
from PIL import Image
import numpy as np
a, b = sys.argv[1], sys.argv[2]
res = {}
for f in sorted(x for x in os.listdir(a) if x.endswith('.png')):
    A = np.asarray(Image.open(os.path.join(a, f)).convert('RGB'), dtype=np.int16)
    B = np.asarray(Image.open(os.path.join(b, f)).convert('RGB'), dtype=np.int16)
    if A.shape != B.shape: res[f] = {'size_mismatch': [A.shape, B.shape]}; continue
    d = (np.abs(A - B).max(axis=2) > 8)
    res[f] = round(100 * d.mean(), 4)
print(json.dumps(res, indent=0))
