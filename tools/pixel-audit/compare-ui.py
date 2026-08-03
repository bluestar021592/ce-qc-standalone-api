from __future__ import annotations
import json, sys
from pathlib import Path
from PIL import Image, ImageChops, ImageEnhance

HERE = Path(__file__).resolve().parent
REF = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / '01_唯一参考与错误对照' / '01_唯一UI真源_必须逐像素复刻.png'
ACTUAL = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / 'actual-1884x1092.png'
OUT = HERE / 'pixel-audit-output'
OUT.mkdir(exist_ok=True)

ref = Image.open(REF).convert('RGB')
act = Image.open(ACTUAL).convert('RGB')
if act.size != ref.size:
    act = act.resize(ref.size, Image.Resampling.LANCZOS)
    act.save(OUT / 'actual-resized.png')

def changed_ratio(a: Image.Image, b: Image.Image, threshold: int = 24) -> float:
    d = ImageChops.difference(a, b)
    px = d.load(); w, h = d.size
    changed = 0
    for y in range(h):
        for x in range(w):
            r,g,bb = px[x,y]
            if max(r,g,bb) > threshold:
                changed += 1
    return changed / (w*h)

diff = ImageChops.difference(ref, act)
heat = ImageEnhance.Contrast(diff).enhance(3.2)
heat.save(OUT / 'difference-heatmap.png')
blend = Image.blend(ref, act, .5)
blend.save(OUT / 'reference-actual-overlay.png')

regions = json.loads((HERE / 'reference-regions.json').read_text(encoding='utf-8'))
report = {'reference': str(REF), 'actual': str(ACTUAL), 'size': ref.size, 'overall_changed_ratio': round(changed_ratio(ref, act), 6), 'regions': {}}
for name, box in regions.items():
    r = ref.crop(tuple(box)); a = act.crop(tuple(box))
    report['regions'][name] = round(changed_ratio(r, a), 6)

# 该阈值不是允许“随便近似”，而是考虑浏览器字体抗锯齿产生的不可避免像素差。
thresholds = {'overall_changed_ratio': .08, 'sidebar': .05, 'topbar': .06, 'kpi': .08, 'overview': .08, 'charts': .10, 'bottom': .10}
failed = []
if report['overall_changed_ratio'] > thresholds['overall_changed_ratio']:
    failed.append(f"overall={report['overall_changed_ratio']:.2%} > 8%")
for name, value in report['regions'].items():
    if value > thresholds[name]: failed.append(f"{name}={value:.2%} > {thresholds[name]:.0%}")
report['passed'] = not failed
report['failed'] = failed
(OUT / 'pixel-audit-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
if failed:
    raise SystemExit(2)
