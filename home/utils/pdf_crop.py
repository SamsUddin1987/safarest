from django.shortcuts import render
from django.http import HttpResponse
import pymupdf
import os


def parse_page_ranges(range_string, total_pages):
    """
    Parse page numbers and ranges.
    Example: 1, 2, 5-8

    Empty input means all pages.
    """

    if not range_string or not range_string.strip():
        return set(range(1, total_pages + 1))

    selected_pages = set()

    for part in range_string.split(","):

        part = part.strip()

        if not part:
            continue

        try:
            if "-" in part:

                values = part.split("-")

                if len(values) != 2:
                    raise ValueError

                start = int(values[0].strip())
                end = int(values[1].strip())

                if start < 1 or end < start or end > total_pages:
                    raise ValueError

                selected_pages.update(range(start, end + 1))

            else:

                page_number = int(part)

                if page_number < 1 or page_number > total_pages:
                    raise ValueError

                selected_pages.add(page_number)

        except ValueError:
            raise ValueError(
                f"Invalid page selection: '{part}'. "
                f"Use a format such as 1, 2, 5-8. "
                f"This PDF contains {total_pages} pages."
            )

    if not selected_pages:
        raise ValueError("No valid pages selected.")

    return selected_pages

def parse_skip_pages(range_string, total_pages):
    """
    Parse pages to skip.
    Example: 2, 5, 8-10

    Empty input means no pages are skipped.
    """

    skip_pages = set()

    if not range_string or not range_string.strip():
        return skip_pages

    for part in range_string.split(","):

        part = part.strip()

        try:
            if "-" in part:

                values = part.split("-")

                if len(values) != 2:
                    raise ValueError

                start = int(values[0].strip())
                end = int(values[1].strip())

                if start < 1 or end < start or end > total_pages:
                    raise ValueError

                skip_pages.update(range(start, end + 1))

            else:

                page_number = int(part)

                if page_number < 1 or page_number > total_pages:
                    raise ValueError

                skip_pages.add(page_number)

        except ValueError:
            raise ValueError(
                f"Invalid skip page selection: '{part}'. "
                f"Use a format such as 2, 5, 8-10. "
                f"This PDF contains {total_pages} pages."
            )

    return skip_pages


def handle_crop_request(request):
    """
    Crop or clear PDF margins using percentage values.

    Crop:
        Uses the original desktop script's rotation mapping,
        MediaBox coordinates and set_cropbox() method.

    Clear:
        Keeps the original page size and covers the selected
        visual margins with white.

    Multiple files are submitted individually by JavaScript.
    Each request processes one PDF and returns one PDF download.
    """

    if request.method != "POST":
        return render(request, "pdf/crop.html")

    # -----------------------------------------
    # RECEIVE ONE PDF FILE
    # -----------------------------------------

    uploaded_file = request.FILES.get("pdf_file")

    if not uploaded_file:
        return HttpResponse(
            "Please select a PDF file.",
            status=400
        )

    filename = uploaded_file.name

    if not filename.lower().endswith(".pdf"):
        return HttpResponse(
            "Please upload a PDF file only.",
            status=400
        )

    doc = None

    try:

        # -----------------------------------------
        # READ FORM VALUES
        # Values are percentages, not points.
        # -----------------------------------------

        action_mode = request.POST.get(
            "action_mode", "crop"
        ).lower()

        if action_mode not in ("crop", "clear"):
            raise ValueError("Invalid action selected.")

        margin_left_pct = float(
            request.POST.get("margin_left", 0)
        )

        margin_right_pct = float(
            request.POST.get("margin_right", 0)
        )

        margin_top_pct = float(
            request.POST.get("margin_top", 0)
        )

        margin_bottom_pct = float(
            request.POST.get("margin_bottom", 0)
        )

        margins = [
            margin_left_pct,
            margin_right_pct,
            margin_top_pct,
            margin_bottom_pct
        ]

        if any(m < 0 or m >= 100 for m in margins):
            raise ValueError(
                "Each margin must be between 0 and 99.9 percent."
            )

        skip_page_ranges = request.POST.get(
            "skip_pages", ""
        ).strip()

        # -----------------------------------------
        # OPEN PDF
        # -----------------------------------------

        doc = pymupdf.open(
            stream=uploaded_file.read(),
            filetype="pdf"
        )

        if doc.is_encrypted:
            raise ValueError(
                "This PDF is password-protected. "
                "Please upload an unlocked PDF."
            )

        total_pages = len(doc)

        if total_pages == 0:
            raise ValueError("The PDF contains no pages.")

        skip_pages = parse_skip_pages(
            skip_page_ranges,
            total_pages
        )

        # -----------------------------------------
        # PROCESS EACH SELECTED PAGE
        # -----------------------------------------

        for page_number, page in enumerate(doc, start=1):

            # Skip pages excluded by the user
            if page_number in skip_pages:
                continue

            rotation = page.rotation % 360

            # =====================================
            # CROP MODE
            # Based on your original desktop script
            # =====================================

            if action_mode == "crop":

                # Map visual margins to physical PDF
                # margins according to page rotation.

                if rotation == 90:

                    p_left_pct = margin_top_pct
                    p_bottom_pct = margin_left_pct
                    p_right_pct = margin_bottom_pct
                    p_top_pct = margin_right_pct

                elif rotation == 180:

                    p_left_pct = margin_right_pct
                    p_bottom_pct = margin_top_pct
                    p_right_pct = margin_left_pct
                    p_top_pct = margin_bottom_pct

                elif rotation == 270:

                    p_left_pct = margin_bottom_pct
                    p_bottom_pct = margin_right_pct
                    p_right_pct = margin_top_pct
                    p_top_pct = margin_left_pct

                else:

                    p_left_pct = margin_left_pct
                    p_bottom_pct = margin_bottom_pct
                    p_right_pct = margin_right_pct
                    p_top_pct = margin_top_pct

                # Use physical MediaBox.
                m_rect = page.mediabox

                width = m_rect.width
                height = m_rect.height

                # Validate opposing margins.
                if p_left_pct + p_right_pct >= 100:
                    raise ValueError(
                        f"Left and right margins are too large "
                        f"on page {page_number}."
                    )

                if p_top_pct + p_bottom_pct >= 100:
                    raise ValueError(
                        f"Top and bottom margins are too large "
                        f"on page {page_number}."
                    )

                # Calculate coordinates using percentages.
                x0 = (
                    m_rect.x0 +
                    (p_left_pct / 100.0) * width
                )

                x1 = (
                    m_rect.x1 -
                    (p_right_pct / 100.0) * width
                )

                y0 = (
                    m_rect.y0 +
                    (p_top_pct / 100.0) * height
                )

                y1 = (
                    m_rect.y1 -
                    (p_bottom_pct / 100.0) * height
                )

                # Ensure correct coordinate order.
                left_val = min(x0, x1)
                right_val = max(x0, x1)

                top_val = min(y0, y1)
                bottom_val = max(y0, y1)

                # Construct crop rectangle.
                crop_rect = pymupdf.Rect(
                    left_val,
                    top_val,
                    right_val,
                    bottom_val
                )

                # Clamp inside MediaBox.
                crop_rect = crop_rect & page.mediabox

                if (
                    crop_rect.is_empty
                    or crop_rect.is_infinite
                    or crop_rect.width <= 0
                    or crop_rect.height <= 0
                ):
                    raise ValueError(
                        f"Invalid crop area on page {page_number}."
                    )

                # Apply crop boundary.
                page.set_cropbox(crop_rect)

            # =====================================
            # CLEAR MODE
            # Preserve page size and cover margins
            # =====================================

            elif action_mode == "clear":

                # Use visible page dimensions, accounting
                # for the page rotation.
                visible_rect = page.rect

                visual_width = visible_rect.width
                visual_height = visible_rect.height

                # Convert percentage margins to distances.
                left = (
                    margin_left_pct / 100.0
                ) * visual_width

                right = (
                    margin_right_pct / 100.0
                ) * visual_width

                top = (
                    margin_top_pct / 100.0
                ) * visual_height

                bottom = (
                    margin_bottom_pct / 100.0
                ) * visual_height

                if left + right >= visual_width:
                    raise ValueError(
                        f"Left and right margins are too large "
                        f"on page {page_number}."
                    )

                if top + bottom >= visual_height:
                    raise ValueError(
                        f"Top and bottom margins are too large "
                        f"on page {page_number}."
                    )

                # Define margin areas in visual coordinates.
                margin_rectangles = []

                if left > 0:
                    margin_rectangles.append(
                        pymupdf.Rect(
                            visible_rect.x0,
                            visible_rect.y0,
                            visible_rect.x0 + left,
                            visible_rect.y1
                        )
                    )

                if right > 0:
                    margin_rectangles.append(
                        pymupdf.Rect(
                            visible_rect.x1 - right,
                            visible_rect.y0,
                            visible_rect.x1,
                            visible_rect.y1
                        )
                    )

                if top > 0:
                    margin_rectangles.append(
                        pymupdf.Rect(
                            visible_rect.x0,
                            visible_rect.y0,
                            visible_rect.x1,
                            visible_rect.y0 + top
                        )
                    )

                if bottom > 0:
                    margin_rectangles.append(
                        pymupdf.Rect(
                            visible_rect.x0,
                            visible_rect.y1 - bottom,
                            visible_rect.x1,
                            visible_rect.y1
                        )
                    )

                # Convert visual coordinates to the
                # unrotated coordinates used by PyMuPDF.
                derotation = page.derotation_matrix

                for visual_margin in margin_rectangles:

                    drawing_rect = (
                        visual_margin * derotation
                    )

                    drawing_rect = (
                        drawing_rect & page.mediabox
                    )

                    if not drawing_rect.is_empty:
                        page.draw_rect(
                            drawing_rect,
                            color=None,
                            fill=(1, 1, 1),
                            width=0,
                            overlay=True
                        )

        # -----------------------------------------
        # SAVE PDF IN MEMORY
        # -----------------------------------------

        output_data = doc.tobytes(
            garbage=4,
            deflate=True,
            clean=True
        )

        # -----------------------------------------
        # OUTPUT FILENAME
        # -----------------------------------------

        base_name, extension = os.path.splitext(filename)

        if action_mode == "clear":
            output_filename = f"{base_name}_cleared{extension}"
        else:
            output_filename = f"{base_name}_cropped{extension}"

        output_filename = output_filename.replace('"', "_")

        # -----------------------------------------
        # RETURN INDIVIDUAL PDF DOWNLOAD
        # -----------------------------------------

        response = HttpResponse(
            output_data,
            content_type="application/pdf"
        )

        response["Content-Disposition"] = (
            f'attachment; filename="{output_filename}"'
        )

        response["Content-Length"] = len(output_data)

        return response

    except Exception as e:

        return HttpResponse(
            f"Error processing {filename}: {str(e)}",
            status=400
        )

    finally:

        if doc is not None:
            doc.close()