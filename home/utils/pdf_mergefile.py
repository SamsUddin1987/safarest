
from datetime import datetime
from io import BytesIO
from pathlib import Path

from django.http import HttpResponse
from django.shortcuts import render
from pypdf import PdfReader, PdfWriter


def handle_mergefile_request(request):

    template_name = "pdf/mergefile.html"

    # Display page
    if request.method != "POST":
        return render(request, template_name)

    # Get multiple uploaded PDF files
    uploaded_files = request.FILES.getlist("pdf_files")

    if not uploaded_files:
        return render(
            request,
            template_name,
            {"error": "Please select at least one PDF file."},
        )

    writer = PdfWriter()
    readers = []

    try:
        total_pages = 0

        # Process each selected PDF
        for uploaded_file in uploaded_files:

            original_name = Path(uploaded_file.name).name

            if Path(original_name).suffix.lower() != ".pdf":
                raise ValueError(
                    f"{original_name} is not a PDF file."
                )

            uploaded_file.seek(0)

            reader = PdfReader(uploaded_file, strict=False)

            # Handle encrypted PDFs
            if reader.is_encrypted:
                try:
                    decrypt_result = reader.decrypt("")
                except Exception:
                    decrypt_result = 0

                if not decrypt_result:
                    raise ValueError(
                        f"{original_name} is password-protected. "
                        "Please unlock it before merging."
                    )

            if len(reader.pages) == 0:
                raise ValueError(
                    f"{original_name} contains no pages."
                )

            readers.append(reader)

            # Add all pages to the output PDF
            for page in reader.pages:
                writer.add_page(page)
                total_pages += 1

        if total_pages == 0:
            raise ValueError("No pages found in selected PDFs.")

        # Create merged PDF in memory
        output_buffer = BytesIO()

        writer.write(output_buffer)

        pdf_data = output_buffer.getvalue()

        # Generate output filename
        first_file_stem = Path(uploaded_files[0].name).stem

        safe_stem = "".join(
            char if char.isalnum() or char in ("-", "_") else "_"
            for char in first_file_stem
        ).strip("_") or "PDF"

        timestamp = datetime.now().strftime("%H-%M-%S")

        output_filename = (
            f"{safe_stem}_Merged_{timestamp}.pdf"
        )

        # Return PDF as browser download
        response = HttpResponse(
            pdf_data,
            content_type="application/pdf"
        )

        response["Content-Disposition"] = (
            f'attachment; filename="{output_filename}"'
        )

        response["Content-Length"] = str(len(pdf_data))

        return response

    except Exception as exc:

        return render(
            request,
            template_name,
            {
                "error": f"Unable to merge PDF files: {exc}"
            }
        )

    finally:
        writer.close()
