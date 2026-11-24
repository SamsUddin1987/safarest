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


def _render_error(request, message):
    return render(request, TEMPLATE_NAME, {"error": message})


def handle_pdf_to_word_request(request):
    if request.method != "POST":
        return render(request, TEMPLATE_NAME)

    uploaded_file = request.FILES.get("pdf_file")

    if not uploaded_file:
        return _render_error(request, "Please select a PDF file.")

    if Path(uploaded_file.name).suffix.lower() != ".pdf":
        return _render_error(request, "Only PDF files can be converted.")

    max_size = getattr(
        settings,
        "PDF_TO_WORD_MAX_UPLOAD_SIZE",
        100 * 1024 * 1024,
    )
    if uploaded_file.size > max_size:
        return _render_error(
            request,
            "The uploaded PDF exceeds the allowed file size.",
        )

    try:
        with tempfile.TemporaryDirectory(prefix="safarest_pdf_word_") as temp_dir:
            temp_path = Path(temp_dir)
            input_path = temp_path / "input.pdf"
            output_path = temp_path / "converted.docx"

            with input_path.open("wb") as destination:
                for chunk in uploaded_file.chunks():
                    destination.write(chunk)

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

                max_pages = getattr(settings, "PDF_TO_WORD_MAX_PAGES", 500)
                if total_pages > max_pages:
                    raise ValueError(
                        f"This PDF contains {total_pages} pages. "
                        f"The current limit is {max_pages} pages."
                    )

                pages_without_text = [
                    page_number + 1
                    for page_number, page in enumerate(pdf_document)
                    if not page.get_text("text").strip()
                ]
            finally:
                pdf_document.close()

            if pages_without_text:
                page_list = ", ".join(map(str, pages_without_text[:10]))
                if len(pages_without_text) > 10:
                    page_list += ", ..."
                raise ValueError(
                    "This PDF contains scanned/image-only page(s) without "
                    "selectable text (page(s): " + page_list + "). "
                    "This converter currently supports text-based PDFs only. "
                    "Please use a searchable PDF."
                )

            converter = Converter(str(input_path))
            try:
                converter.convert(
                    str(output_path),
                    multi_processing=False,
                )
            finally:
                converter.close()

            if not output_path.exists() or output_path.stat().st_size == 0:
                raise RuntimeError(
                    "The conversion did not produce a valid Word document."
                )

            docx_data = output_path.read_bytes()

        original_stem = Path(uploaded_file.name).stem
        safe_stem = re.sub(
            r"[^A-Za-z0-9_-]+",
            "_",
            original_stem,
        ).strip("_") or "Document"

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_filename = f"{safe_stem}_Converted_{timestamp}.docx"

        response = HttpResponse(
            docx_data,
            content_type=DOCX_CONTENT_TYPE,
        )
        response["Content-Disposition"] = (
            f'attachment; filename="{output_filename}"'
        )
        response["Content-Length"] = str(len(docx_data))
        response["X-Content-Type-Options"] = "nosniff"
        return response

    except ValueError as exc:
        return _render_error(request, str(exc))

    except Exception:
        logger.exception("PDF to Word conversion failed.")
        return _render_error(
            request,
            "Unable to convert this PDF. Please check the document "
            "and try again.",
        )
