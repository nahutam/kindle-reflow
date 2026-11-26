import os
import sys
import pymupdf

def analyze_pdf(pdf_path, name):
    doc = pymupdf.open(pdf_path)
    print(f"\n=======================================================")
    print(f"Analysis for {name}: {pdf_path}")
    print(f"Page count: {len(doc)}, File size: {os.path.getsize(pdf_path)} bytes")
    print(f"=======================================================")

    pages_with_basic = []
    pages_with_amphoteric = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text()
        if "basic oxide" in text.lower() or "basic oxides" in text.lower():
            pages_with_basic.append(page_num + 1)
        if "amphoteric" in text.lower():
            pages_with_amphoteric.append(page_num + 1)

    print(f"Pages mentioning 'Basic Oxides': {pages_with_basic}")
    print(f"Pages mentioning 'Amphoteric Oxides': {pages_with_amphoteric}")

    doc.close()
    return pages_with_basic, pages_with_amphoteric

def render_pages_to_images(pdf_path, page_numbers, output_prefix, dpi=150):
    os.makedirs(os.path.dirname(output_prefix), exist_ok=True)
    doc = pymupdf.open(pdf_path)
    rendered_files = []
    mat = pymupdf.Matrix(dpi / 72.0, dpi / 72.0)

    for pno in page_numbers:
        if 1 <= pno <= len(doc):
            page = doc[pno - 1]
            pix = page.get_pixmap(matrix=mat)
            out_file = f"{output_prefix}_page_{pno}.png"
            pix.save(out_file)
            rendered_files.append(out_file)
            print(f"Rendered {pdf_path} page {pno} -> {out_file} ({pix.width}x{pix.height})")

    doc.close()
    return rendered_files

def inspect_text_and_fonts(pdf_path, page_numbers):
    doc = pymupdf.open(pdf_path)
    print(f"\n--- Detailed Inspection of {pdf_path} ---")
    for pno in page_numbers:
        page = doc[pno - 1]
        text_page = page.get_text("dict")
        print(f"\n--- Page {pno} ---")
        for block in text_page.get("blocks", []):
            if "lines" in block:
                for line in block["lines"]:
                    line_spans = []
                    for span in line["spans"]:
                        text = span.get("text", "")
                        font = span.get("font", "")
                        flags = span.get("flags", 0)
                        size = round(span.get("size", 0), 1)
                        is_bold = bool(flags & 2) or ("bold" in font.lower())
                        is_italic = bool(flags & 1) or ("italic" in font.lower())
                        style_tag = ("B" if is_bold else "") + ("I" if is_italic else "")
                        line_spans.append(f"[{font} {size}pt {style_tag}] '{text}'")
                    full_line_text = "".join(span.get("text", "") for span in line["spans"]).strip()
                    if full_line_text:
                        print(f"  Line: {full_line_text}")
                        # If line has interesting symbols or mixed fonts
                        if any(k in full_line_text.lower() for k in ["oxide", "h2o", "co2", "zno", "al2o3", "na2o", "cao", "defn:", "acid"]):
                            print(f"    Spans: {' '.join(line_spans)}")
            elif "image" in block:
                bbox = block.get("bbox", [])
                width = block.get("width", 0)
                height = block.get("height", 0)
                print(f"  [Image block: bbox={bbox}, size={width}x{height}]")
    doc.close()

if __name__ == "__main__":
    orig_path = "regression-data/unit_3.pdf"
    corrupt_path = "regression-data/unit_3-kindle-notes-corrupted.pdf"
    fixed_path = "regression-data/unit_3-kindle-notes-fixed.pdf"

    o_basic, o_ampho = analyze_pdf(orig_path, "Original unit_3.pdf")
    c_basic, c_ampho = analyze_pdf(corrupt_path, "Corrupted Previous Output")
    f_basic, f_ampho = analyze_pdf(fixed_path, "Fixed Current Output")

    # Render key pages for visual inspection
    render_pages_to_images(orig_path, o_basic + o_ampho, "regression-data/renders/orig")
    render_pages_to_images(corrupt_path, c_basic + c_ampho, "regression-data/renders/corrupted")
    render_pages_to_images(fixed_path, f_basic + f_ampho, "regression-data/renders/fixed")

    # Detailed inspection of the fixed output
    inspect_text_and_fonts(fixed_path, f_basic + f_ampho)
