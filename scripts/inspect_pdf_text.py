import sys
import pymupdf

def inspect_pdf(pdf_path):
    doc = pymupdf.open(pdf_path)
    print(f"=== INSPECTION REPORT FOR {pdf_path} ({len(doc)} pages) ===")
    for i, page in enumerate(doc):
        print(f"\n--- PAGE {i + 1} ---")
        text = page.get_text()
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        for line in lines:
            print(f"  {line[:100]}")
        images = page.get_images()
        if images:
            for img in images:
                rects = page.get_image_rects(img[0])
                if rects:
                    print(f"  >> [IMAGE] xref={img[0]}, rects={rects}")
    doc.close()

if __name__ == "__main__":
    pdf_path = sys.argv[1] if len(sys.argv) > 1 else "scripts/baseline/breathing-systems-baseline.pdf"
    inspect_pdf(pdf_path)
