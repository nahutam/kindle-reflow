import pymupdf

doc = pymupdf.open("regression-data/unit_3.pdf")
page = doc[0] # Page 1
print(f"=== PAGE 1 TEXT BLOCKS AND SPANS ===")
text_page = page.get_text("dict")
for b_idx, block in enumerate(text_page.get("blocks", [])):
    if "lines" in block:
        bbox = [round(x, 1) for x in block["bbox"]]
        full_b_text = ""
        for line in block["lines"]:
            for span in line["spans"]:
                full_b_text += span["text"]
        print(f"\nBlock {b_idx} {bbox}: {repr(full_b_text)}")
        for l_idx, line in enumerate(block["lines"]):
            line_box = [round(x, 1) for x in line["bbox"]]
            spans_str = []
            for span in line["spans"]:
                spans_str.append(f"({round(span['bbox'][0],1)},{round(span['bbox'][1],1)} - {round(span['bbox'][2],1)},{round(span['bbox'][3],1)}) [{span['font']} {round(span['size'],1)}pt] {repr(span['text'])}")
            print(f"  Line {l_idx} {line_box}: {' | '.join(spans_str)}")

doc.close()
