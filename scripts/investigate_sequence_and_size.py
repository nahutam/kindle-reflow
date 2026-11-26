import pymupdf
import json

doc = pymupdf.open("regression-data/unit_3.pdf")
print("=== INVESTIGATION OF ORIGINAL unit_3.pdf ===")
for pno in [0, 1, 2, 3, 5, 6, 9, 10, 11, 13]: # 0-indexed: 1,2,3,4,6,7,10,11,12,14
    if pno >= len(doc):
        continue
    page = doc[pno]
    print(f"\n--- PAGE {pno + 1} ({page.rect.width}x{page.rect.height} pt) ---")
    blocks = page.get_text("blocks")
    for b in blocks:
        # (x0, y0, x1, y1, text, block_no, block_type)
        txt = b[4].strip()
        if any(w in txt for w in ["Defn:", "carbides", "CO", "pH", "Arrhenius", "Monoprotic", "Polyprotic", "Strong", "Weak"]):
            print(f"  Block [{b[0]:.1f}, {b[1]:.1f}, {b[2]:.1f}, {b[3]:.1f}]: {repr(txt)}")

doc.close()

# Also inspect images in the fixed output PDF
fixed_doc = pymupdf.open("regression-data/unit_3-kindle-notes-fixed.pdf")
print("\n=== INVESTIGATION OF GENERATED unit_3-kindle-notes-fixed.pdf IMAGES ===")
print(f"Total pages: {len(fixed_doc)}")
total_img_size = 0
img_count = 0
for pno in range(len(fixed_doc)):
    page = fixed_doc[pno]
    img_list = page.get_images(full=True)
    if img_list:
        print(f"Page {pno + 1} has {len(img_list)} images:")
        for img in img_list:
            xref = img[0]
            base_image = fixed_doc.extract_image(xref)
            image_bytes = base_image["image"]
            ext = base_image["ext"]
            width = base_image["width"]
            height = base_image["height"]
            size_kb = len(image_bytes) / 1024
            total_img_size += len(image_bytes)
            img_count += 1
            print(f"  xref {xref}: {width}x{height} {ext}, {size_kb:.1f} KB")

print(f"\nTotal embedded images: {img_count}")
print(f"Total image payload size: {total_img_size / (1024 * 1024):.2f} MB")
fixed_doc.close()
