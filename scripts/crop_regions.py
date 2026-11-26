import os
import sys
import json
import base64
import pymupdf

def crop_regions(pdf_path, crops, dpi=300):
    doc = pymupdf.open(pdf_path)
    zoom = dpi / 72.0
    mat = pymupdf.Matrix(zoom, zoom)
    results = {}

    for crop in crops:
        cid = crop["id"]
        pno = crop["page"] - 1 # 1-indexed to 0-indexed
        box = crop["box"] # [x0, y0, x1, y1] in points
        # Add safe padding (3pt horizontal, 3pt top, 5pt bottom) so descenders (g, y, p, q) are never clipped
        rect = pymupdf.Rect(box[0] - 3, box[1] - 3, box[2] + 3, box[3] + 5)
        
        page = doc[pno]
        # Intersect with page rect
        rect = rect & page.rect
        pix = page.get_pixmap(matrix=mat, clip=rect)
        # Use JPEG quality 82 for compact, high-clarity E-Ink PDF embedding
        jpg_bytes = pix.tobytes("jpeg", jpg_quality=82)
        b64 = base64.b64encode(jpg_bytes).decode("ascii")
        results[cid] = {
            "data": f"data:image/jpeg;base64,{b64}",
            "format": "JPEG",
            "pixelWidth": pix.width,
            "pixelHeight": pix.height
        }

    doc.close()
    return results

if __name__ == "__main__":
    input_data = json.loads(sys.stdin.read())
    pdf_path = input_data["pdfPath"]
    crops = input_data["crops"]
    dpi = input_data.get("dpi", 300)
    res = crop_regions(pdf_path, crops, dpi)
    print(json.dumps(res))
