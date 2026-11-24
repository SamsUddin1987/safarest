
import logging
import re
import tempfile
from datetime import datetime
from pathlib import Path

import fitz
from pdf2docx import Converter

from django.conf import settings
from django.http import HttpResponse
from django.shortcuts import render


logger = logging.getLogger(__name__)

TEMPLATE_NAME = "pdf/to_word.html"

DOCX_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument."
    "wordprocessingml.document"
)


def handle_pdf_to_word_request(request):

    if request.method != "POST":
        return render(request, TEMPLATE_NAME)

    uploaded_file = request.FILES.get("pdf_file")

    if not uploaded_file:
        return render(
            request,
            TEMPLATE_NAME,
            {"error": "Please select a PDF file."}
        )

    if Path(uploaded_file.name).suffix.lower() != ".pdf":
        return render(
            request,
            TEMPLATE_NAME,
            {"error": "Only PDF files can be converted."}
        )

    max_size = getattr(
        settings,
        "PDF_TO_WORD_MAX_UPLOAD_SIZE",
        100 * 1024 * 1024
    )

    if uploaded_file.size > max_size:
        return render(
            request,
            TEMPLATE_NAME,
            {"error": "The uploaded PDF exceeds the allowed file size."}
        )

    try:

        with tempfile.TemporaryDirectory() as temp_dir:

            temp_path = Path(temp_dir)

            input_path = temp_path / "input.pdf"
            output_path = temp_path / "converted.docx"

            # Save uploaded PDF temporarily.
            with input_path.open("wb") as destination:
                for chunk in uploaded_file.chunks():
                    destination.write(chunk)

            # Validate PDF and inspect its contents.
            pdf_document = fitz.open(str(input_path))

            try:

                if pdf_document.needs_pass:
                    raise ValueError(
                        "This PDF is password-protected. "
                        "Please unlock it before conversion."
                    )

                total_pages = len(pdf_document)

                if total_pages == 0:
                    raise ValueError("The PDF contains no pages.")

                text_found = any(
                    page.get_text("text").strip()
                    for page in pdf_document
                )

                if not text_found:
                    raise ValueError(
                        "This appears to be a scanned PDF without "
                        "extractable text. OCR processing is required "
                        "before editable Word conversion."
                    )

            finally:
                pdf_document.close()

            # Convert PDF to editable Word document.
            converter = Converter(str(input_path))

            try:
                converter.convert(
                    str(output_path),
                    multi_processing=False
                )
            finally:
                converter.close()

            if not output_path.exists() or output_path.stat().st_size == 0:
                raise ValueError(
                    "The conversion did not produce a valid Word document."
                )

            docx_data = output_path.read_bytes()

        # Generate a safe output filename.
        original_stem = Path(uploaded_file.name).stem

        safe_stem = re.sub(
            r"[^A-Za-z0-9_-]+",
            "_",
            original_stem
        ).strip("_") or "Document"

        timestamp = datetime.now().strftime("%H-%M-%S")

        output_filename = (
            f"{safe_stem}_Converted_{timestamp}.docx"
        )

        response = HttpResponse(
            docx_data,
            content_type=DOCX_CONTENT_TYPE
        )

        response["Content-Disposition"] = (
            f'attachment; filename="{output_filename}"'
        )

        response["Content-Length"] = str(len(docx_data))
        response["X-Content-Type-Options"] = "nosniff"

        return response

    except ValueError as exc:

        return render(
            request,
            TEMPLATE_NAME,
            {"error": str(exc)}
        )

    except Exception:

        logger.exception("PDF to Word conversion failed.")

        return render(
            request,
            TEMPLATE_NAME,
            {
                "error": (
                    "Unable to convert this PDF. "
                    "Please check the document and try again."
                )
            }
        )
