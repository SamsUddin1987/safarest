from io import BytesIO
from pathlib import Path
from datetime import datetime
import re

from django.http import HttpResponse
from django.shortcuts import render

from pypdf import PdfReader, PdfWriter


def parse_page_input(user_input):
    """
    Converts page input such as:
    '1, 3, 5-8, 2' into zero-indexed page numbers:
    [0, 2, 4, 5, 6, 7, 1]

    Supports reverse ranges such as '7-5'.
    """

    pages = []

    if not user_input or not user_input.strip():
        raise ValueError("Please enter the page sequence.")

    parts = user_input.split(",")

    for part in parts:
        part = part.strip()

        if not part:
            raise ValueError("Please check the page sequence. An empty entry was found.")

        # Handle page ranges, e.g. 5-8 or 8-5
        if re.fullmatch(r"\d+\s*-\s*\d+", part):
            start, end = [
                int(value.strip()) for value in part.split("-")
            ]

            if start < 1 or end < 1:
                raise ValueError("Page numbers must start from 1.")

            step = 1 if start <= end else -1

            pages.extend(
                range(start - 1, end - 1 + step, step)
            )

        # Handle individual page numbers, e.g. 1 or 5
        elif part.isdigit():
            page_number = int(part)

            if page_number < 1:
                raise ValueError("Page numbers must start from 1.")

            pages.append(page_number - 1)

        else:
            raise ValueError(
                f"Invalid page entry: '{part}'. "
                "Use a format such as 1, 3, 5-8, 2."
            )

    return pages


def handle_mergepage_request(request):

    if request.method == "GET":
        return render(request, "pdf/mergepage.html")

    if request.method == "POST":

        uploaded_file = request.FILES.get("pdf_file")
        user_input = request.POST.get("page_sequence", "").strip()

        if not uploaded_file:
            return render(
                request,
                "pdf/mergepage.html",
                {"error": "Please select a PDF file."}
            )

        if not uploaded_file.name.lower().endswith(".pdf"):
            return render(
                request,
                "pdf/mergepage.html",
                {"error": "Only PDF files are allowed."}
            )

        reader = None
        writer = PdfWriter()

        try:
            # Read the uploaded PDF
            reader = PdfReader(uploaded_file, strict=False)

            # Try opening PDFs protected with an empty password
            if reader.is_encrypted:
                decrypt_result = reader.decrypt("")

                if not decrypt_result:
                    raise ValueError(
                        "This PDF is password-protected. "
                        "Please upload an unlocked PDF."
                    )

            total_pages = len(reader.pages)

            if total_pages == 0:
                raise ValueError("The selected PDF contains no pages.")

            # Convert the entered sequence into page indexes
            selected_pages = parse_page_input(user_input)

            # Validate page numbers before creating the output
            invalid_pages = [
                page_num + 1
                for page_num in selected_pages
                if page_num < 0 or page_num >= total_pages
            ]

            if invalid_pages:
                invalid_text = ", ".join(map(str, invalid_pages))

                raise ValueError(
                    f"Page number(s) {invalid_text} are outside the "
                    f"available range. This PDF has {total_pages} pages."
                )

            # Add pages in the exact order entered
            for page_num in selected_pages:
                writer.add_page(reader.pages[page_num])

            if len(writer.pages) == 0:
                raise ValueError("No pages were selected for merging.")

            # Create output PDF in memory
            output_buffer = BytesIO()
            writer.write(output_buffer)
            output_buffer.seek(0)

            # Original file name without extension
            original_file_name = Path(uploaded_file.name).stem

            # Remove unsafe characters from the file name
            original_file_name = re.sub(
                r"[^A-Za-z0-9_-]+",
                "_",
                original_file_name
            )

            # Generate output file name
            current_datetime = datetime.now().strftime("%H-%M-%S")

            output_file_name = (
                f"{original_file_name}_merge_pages_"
                f"{current_datetime}.pdf"
            )

            # Return the PDF for browser download
            response = HttpResponse(
                output_buffer.getvalue(),
                content_type="application/pdf"
            )

            response["Content-Disposition"] = (
                f'attachment; filename="{output_file_name}"'
            )

            response["Content-Length"] = len(output_buffer.getvalue())

            return response

        except Exception as error:
            return render(
                request,
                "pdf/mergepage.html",
                {
                    "error": str(error),
                    "selected_sequence": user_input,
                    "total_pages": (
                        len(reader.pages) if reader is not None else None
                    ),
                }
            )

        finally:
            writer.close()

    return render(request, "pdf/mergepage.html")
