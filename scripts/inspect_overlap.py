import pymupdf

doc = pymupdf.open("regression-data/unit_3.pdf")
page = doc[0]
text_page = page.get_text("dict")
print("=== PAGE 1 ALL SPANS BETWEEN Y=255 AND 280 ===")
spans = []
for b in text_page.get("blocks", []):
    if "lines" in b:
        for l in b["lines"]:
            for s in l["spans"]:
                if 250 <= s["bbox"][1] <= 285:
                    spans.append(s)

spans.sort(key=lambda s: s["bbox"][0]) # sort by X
for s in spans:
    bbox = [round(x, 1) for x in s["bbox"]]
    print(f"[{bbox[0]:.1f}, {bbox[1]:.1f}, {bbox[2]:.1f}, {bbox[3]:.1f}] ({s['font']}) : {repr(s['text'])}")

doc.close()
