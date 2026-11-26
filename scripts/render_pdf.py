import os
import sys
import pymupdf

def render_pdf_to_images(pdf_path, output_dir, prefix="page"):
    os.makedirs(output_dir, exist_ok=True)
    doc = pymupdf.open(pdf_path)
    print(f"Rendering {pdf_path} ({len(doc)} pages) to {output_dir}...")
    image_paths = []
    # 150 DPI (scale = 150 / 72 = 2.08333)
    zoom = 150.0 / 72.0
    mat = pymupdf.Matrix(zoom, zoom)
    for i, page in enumerate(doc):
        pix = page.get_pixmap(matrix=mat)
        out_name = f"{prefix}_{i + 1}.png"
        out_file = os.path.join(output_dir, out_name)
        pix.save(out_file)
        print(f"  Saved page {i + 1} to {out_file} ({pix.width}x{pix.height})")
        image_paths.append(out_file)
    doc.close()
    return image_paths

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python render_pdf.py <pdf_path> <output_dir> [prefix]")
        sys.exit(1)
    pdf_path = sys.argv[1]
    output_dir = sys.argv[2]
    prefix = sys.argv[3] if len(sys.argv) > 3 else "page"
    render_pdf_to_images(pdf_path, output_dir, prefix)
