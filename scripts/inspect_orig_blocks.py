import pymupdf

doc = pymupdf.open("regression-data/unit_3.pdf")
print("Original unit_3.pdf - Page 1 to 3 blocks:")
for pno in range(min(4, len(doc))):
    page = doc[pno]
    print(f"\n=================== ORIGINAL PAGE {pno + 1} ===================")
    blocks = page.get_text("blocks")
    for b in blocks:
        text = b[4].strip()
        if text:
            print(f"[{b[0]:.1f}, {b[1]:.1f}, {b[2]:.1f}, {b[3]:.1f}]: {repr(text)}")
doc.close()
