import pymupdf

doc = pymupdf.open("regression-data/unit_3.pdf")
print("=== NOTION / KATEX / FORMULA INSPECTION ACROSS ALL 14 PAGES ===")
for pno in range(len(doc)):
    page = doc[pno]
    text_page = page.get_text("dict")
    katex_spans = []
    normal_spans = []
    for block in text_page.get("blocks", []):
        if "lines" in block:
            for line in block["lines"]:
                for span in line["spans"]:
                    font = span["font"]
                    txt = span["text"].strip()
                    if txt:
                        if "katex" in font.lower():
                            katex_spans.append((span["bbox"], txt, font))
                        else:
                            normal_spans.append((span["bbox"], txt, font))
    print(f"Page {pno + 1}: {len(katex_spans)} KaTeX spans, {len(normal_spans)} normal spans")

doc.close()
