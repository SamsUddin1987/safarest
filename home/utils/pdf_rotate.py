
from django.shortcuts import render
from django.http import HttpResponse
from pypdf import PdfWriter, PdfReader
from datetime import datetime
import io
import os
import re


def parse_skip_pages(value, total_pages):
    """
    Convert page input such as:
    2,5,8-10 into zero-based page indexes.
    """

    skip_pages = set()

    if not value or not value.strip():
        return skip_pages

    parts = value.split(",")

    for part in parts:

        part = part.strip()

        if not part:
            raise ValueError("Invalid page selection.")

        if re.fullmatch(r"\d+", part):

            page_number = int(part)

            if page_number < 1 or page_number > total_pages:
                raise ValueError(
                    f"Page {page_number} is outside the PDF page range."
                )

            skip_pages.add(page_number - 1)

        elif re.fullmatch(r"\d+\s*-\s*\d+", part):

            start, end = map(int, re.split(r"\s*-\s*", part))

            if start < 1 or end > total_pages or start > end:
                raise ValueError(
                    f"Invalid page range: {part}"
                )

            skip_pages.update(range(start - 1, end))

        else:
            raise ValueError(
                f"Invalid page number or range: {part}"
            )

    return skip_pages


def handle_rotate_request(request):

    if request.method != "POST":
        return render(request, "pdf/rotate.html")

    files = request.FILES.getlist("pdf_files")

    if not files:
        return HttpResponse(
            "Please select at least one PDF file.",
            status=400
        )

    angle_input = request.POST.get("angle")

    if not angle_input:
        return HttpResponse(
            "Please select a rotation angle.",
            status=400
        )

    try:

        angle = int(angle_input)

        if angle not in (90, 180, 270):
            raise ValueError(
                "Select 90, 180 or 270 degrees."
            )

        if len(files) != 1:
            return HttpResponse(
                "Please submit one PDF file per request.",
                status=400
            )

        uploaded_file = files[0]

        if not uploaded_file.name.lower().endswith(".pdf"):
            raise ValueError("Please upload PDF files only.")

        reader = PdfReader(uploaded_file)

        if reader.is_encrypted:
            raise ValueError(
                "Password-protected PDFs are not supported."
            )

        total_pages = len(reader.pages)

        # Pages entered here will retain their original orientation
        skip_input = request.POST.get("skip_pages", "")

        skip_pages = parse_skip_pages(
            skip_input,
            total_pages
        )

        writer = PdfWriter()

        # Rotate all pages except the excluded pages
        for page_number, page in enumerate(reader.pages):

            if page_number not in skip_pages:
                page.rotate(angle)

            writer.add_page(page)

        buffer = io.BytesIO()

        writer.write(buffer)
        writer.close()

        buffer.seek(0)

        original_file_name = os.path.splitext(
            os.path.basename(uploaded_file.name)
        )[0]

        current_datetime = datetime.now().strftime(
            "%H-%M-%S"
        )

        output_file_name = (
            f"{original_file_name}_Rotate_{current_datetime}.pdf"
        )

        pdf_content = buffer.getvalue()

        response = HttpResponse(
            pdf_content,
            content_type="application/pdf"
        )

        response["Content-Disposition"] = (
            f'attachment; filename="{output_file_name}"'
        )

        response["Content-Length"] = len(pdf_content)

        buffer.close()

        return response

    except Exception as e:

        return HttpResponse(
            f"Error rotating PDF: {str(e)}",
            status=400
        )
