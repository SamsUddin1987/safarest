SAFAREST OCR removal patch

Replace these files in the project, preserving the folder paths:
- requirements.txt
- home/utils/pdf_to_word.py
- home/templates/pdf/to_word.html

Also delete this obsolete backup file if it still exists:
- home/utils/pdf_to_word1.py

No changes are required to home/views.py, mysite/urls.py, or home/templates/base.html.
The PDF-to-Word URL and menu item remain active.

The revised converter supports PDFs with selectable text only. Scanned/image-only
PDFs are rejected with a clear message. No OCR processing is performed.

The requirements file removes both OCRmyPDF and pymupdf4llm. The latter was
not imported by the inspected application source and brings additional layout /
ONNX Runtime dependencies into the deployment.

After replacing the files, run:
  python -m pip uninstall ocrmypdf pymupdf4llm pymupdf-layout -y
  python -m pip install -r requirements.txt

Then verify locally before committing and deploying.
