import logging
import re
import subprocess
import sys
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

# Language codes must match Tesseract's traineddata filenames.
OCR_LANGUAGES = {
    "eng": "English",
    "asm": "Assamese",
    "ben": "Bengali",
    "guj": "Gujarati",
    "hin": "Hindi",
    "kan": "Kannada",
    "mal": "Malayalam",
    "mar": "Marathi",
    "nep": "Nepali",
    "ori": "Odia",
    "pan": "Punjabi",
    "tam": "Tamil",
    "tel": "Telugu",
    "urd": "Urdu",
}

DEFAULT_OCR_LANGUAGES = ["eng"]


def _render_error(request, message, selected_languages=None):
    return render(
        request,
        TEMPLATE_NAME,
        {
            "error": message,
            "ocr_languages": OCR_LANGUAGES,
            "selected_languages": (
                selected_languages or DEFAULT_OCR_LANGUAGES
            ),
        },
    )


def _check_ocr_installation(language_codes):
    """
    Check OCRmyPDF and Tesseract language packs before starting a job.
    Returns a clear setup error instead of a generic conversion failure.
    """
    try:
        version_check = subprocess.run(
            [sys.executable, "-m", "ocrmypdf", "--version"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError(
            "OCR software is not available in this Python environment. "
            "Install OCRmyPDF and its required system dependencies."
        )

    if version_check.returncode != 0:
        raise RuntimeError(
            "OCRmyPDF is not installed correctly. "
            "Install it in the active Django virtual environment."
        )

    try:
        language_check = subprocess.run(
            ["tesseract", "--list-langs"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError(
            "Tesseract OCR is not installed or is not available in PATH."
        )

    if language_check.returncode != 0:
        raise RuntimeError(
            "Unable to read installed Tesseract language data."
        )

    installed_languages = set()
    for line in (language_check.stdout or "").splitlines():
        code = line.strip()
        if code and code.lower() not in {
            "list of available languages (",
            "list of available languages:",
        }:
            installed_languages.add(code)

    missing = [
        code for code in language_codes
        if code not in installed_languages
    ]

    if missing:
        missing_names = ", ".join(
            OCR_LANGUAGES.get(code, code) for code in missing
        )
        raise RuntimeError(
            f"Missing Tesseract language data: {missing_names}. "
            "Install the corresponding .traineddata files and try again."
        )


def _run_ocr(input_path, searchable_path, language_codes):
    """
    Add an OCR text layer to scanned pages. Existing text pages are kept.
    """
    command = [
        sys.executable,
        "-m",
        "ocrmypdf",
        "--skip-text",
        "--rotate-pages",
        "--deskew",
        "--output-type",
        "pdf",
        "--language",
        "+".join(language_codes),
        str(input_path),
        str(searchable_path),
    ]

    timeout_seconds = getattr(
        settings,
        "PDF_TO_WORD_OCR_TIMEOUT",
        900,
    )

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(
            "OCR processing exceeded the allowed time. "
            "Try a smaller PDF or split the document into smaller parts."
        )
    except OSError:
        raise RuntimeError(
            "Unable to start OCRmyPDF. Check the OCR installation."
        )

    if result.returncode != 0:
        diagnostic = (result.stderr or result.stdout or "").strip()
        logger.error("OCRmyPDF failed: %s", diagnostic[-4000:])
        raise RuntimeError(
            "OCR processing failed. Check that Ghostscript, Tesseract "
            "and the selected language data are installed correctly. "
            "The PDF may also contain unsupported or damaged content."
        )

    if not searchable_path.exists() or searchable_path.stat().st_size == 0:
        raise RuntimeError("OCR did not produce a searchable PDF.")


def handle_pdf_to_word_request(request):

    if request.method != "POST":
        return render(
            request,
            TEMPLATE_NAME,
            {
                "ocr_languages": OCR_LANGUAGES,
                "selected_languages": DEFAULT_OCR_LANGUAGES,
            },
        )

    uploaded_file = request.FILES.get("pdf_file")

    if not uploaded_file:
        return _render_error(
            request,
            "Please select a PDF file.",
        )

    if Path(uploaded_file.name).suffix.lower() != ".pdf":
        return _render_error(
            request,
            "Only PDF files can be converted.",
        )

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

    selected_languages = request.POST.getlist("ocr_languages")
    if not selected_languages:
        selected_languages = DEFAULT_OCR_LANGUAGES.copy()

    # Accept only known codes. Never pass arbitrary user input to a command.
    selected_languages = list(dict.fromkeys(selected_languages))
    invalid_languages = [
        code for code in selected_languages
        if code not in OCR_LANGUAGES
    ]

    if invalid_languages:
        return _render_error(
            request,
            "One or more selected OCR languages are invalid.",
            selected_languages,
        )

    try:
        with tempfile.TemporaryDirectory(prefix="safarest_pdf_word_") as temp_dir:
            temp_path = Path(temp_dir)
            input_path = temp_path / "input.pdf"
            searchable_path = temp_path / "searchable.pdf"
            output_path = temp_path / "converted.docx"

            # Stream upload to a temporary file.
            with input_path.open("wb") as destination:
                for chunk in uploaded_file.chunks():
                    destination.write(chunk)

            # Validate the PDF and classify pages as text or image scans.
            pdf_document = fitz.open(str(input_path))

            try:
                if pdf_document.needs_pass:
                    raise ValueError(
                        "This PDF is password-protected. "
                        "Please unlock it before conversion."
                    )

                if len(pdf_document) == 0:
                    raise ValueError("The PDF contains no pages.")

                max_pages = getattr(
                    settings,
                    "PDF_TO_WORD_MAX_PAGES",
                    500,
                )
                if len(pdf_document) > max_pages:
                    raise ValueError(
                        f"This PDF contains {len(pdf_document)} pages. "
                        f"The current limit is {max_pages} pages."
                    )

                pages_without_text = [
                    page_number
                    for page_number, page in enumerate(pdf_document)
                    if not page.get_text("text").strip()
                ]

                total_pages = len(pdf_document)

            finally:
                pdf_document.close()

            conversion_input = input_path

            # OCR only when at least one page has no selectable text.
            # --skip-text preserves pages that already contain text.
            if pages_without_text:
                _check_ocr_installation(selected_languages)
                _run_ocr(
                    input_path,
                    searchable_path,
                    selected_languages,
                )
                conversion_input = searchable_path

            converter = Converter(str(conversion_input))
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
        return _render_error(
            request,
            str(exc),
            selected_languages,
        )

    except RuntimeError as exc:
        return _render_error(
            request,
            str(exc),
            selected_languages,
        )

    except Exception:
        logger.exception("PDF to Word conversion failed.")
        return _render_error(
            request,
            "Unable to convert this PDF. Please check the document "
            "and OCR installation, then try again.",
            selected_languages,
        )
