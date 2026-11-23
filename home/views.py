import json
from django.shortcuts import render
from django.http import HttpResponse, JsonResponse
import os
import tempfile
import subprocess
from pathlib import Path
from django.conf import settings

# PDF UTILITIES
from .utils.pdf_mergefile import handle_mergefile_request
from .utils.pdf_mergepage import handle_mergepage_request
from .utils.pdf_split import handle_split_request
from .utils.pdf_rotate import handle_rotate_request
from .utils.pdf_crop import handle_crop_request
from .utils.pdf_unlock import handle_unlock_request
from .utils.pdf_lock import handle_lock_request
from .utils.pdf_shade import handle_shade_request, save_shade_sample

# =========================
# GENERAL PAGES
# =========================

def home(request):
    return render(request, "home.html")

def about(request):
    return render(request, "about.html")

def assistant(request):
    return render(request, "assistant.html")

# =========================
# SAFAR EDGE PWA SERVICE WORKER
# =========================

def safaredge_service_worker(request):

    worker_path = (
        Path(settings.BASE_DIR)
        / "home"
        / "static"
        / "service-worker.js"
    )

    if not worker_path.exists():
        return HttpResponse(
            "Service worker file not found.",
            status=404
        )

    content = worker_path.read_text(encoding="utf-8")

    response = HttpResponse(
        content,
        content_type="application/javascript"
    )

    # Allow service worker to control the entire website.
    response["Service-Worker-Allowed"] = "/"

    # Prevent stale service worker scripts.
    response["Cache-Control"] = "no-cache"

    return response

# =========================
# UNIFIED ESTIMATION & CAD WORKSPACE
# =========================

def workspace_view(request, tool_type='cad_default'):
    title_map = {
        'cad_default': 'CAD & Sheet Workspace',
        'footing': 'Footing Estimation',
        'beam': 'Beam Estimation',
        'column': 'Column Estimation',
        'slab': 'Slab Estimation',
        'retaining_wall': 'Retaining Wall Estimation',
        'sample': 'Sample Estimation',
    }
    
    context = {
        'tool_title': title_map.get(tool_type, 'CAD Workspace'),
        'tool_type': tool_type,
    }
    
    # Unified template for both CAD & Estimation submenus
    return render(request, 'cad_workspace.html', context)

# Backward-compatibility alias (in case legacy URLs call cad_workspace)
cad_workspace = workspace_view

# =========================
# QA/QC
# =========================

def qaqc_moisture(request):
    return render(request, "qaqc/moisture.html")

def qaqc_sieve(request):
    return render(request, "qaqc/sieve.html")

def qaqc_cube(request):
    return render(request, "qaqc/cube.html")

def qaqc_silt(request):
    return render(request, "qaqc/silt.html")

def qaqc_bulkage(request):
    return render(request, "qaqc/bulkage.html")

# =========================
# SURVEY
# =========================

def sur_sympson(request):
    return render(request, "survey/sympson.html")

def sur_area(request):
    return render(request, "survey/area.html")

# =========================
# CIVIL APTITUDE
# =========================

def apt_weight(request):
    return render(request, "aptitude/weight.html")

def apt_area(request):
    return render(request, "aptitude/area.html")

def apt_volume(request):
    return render(request, "aptitude/volume.html")

# =========================
# PDF TOOLS
# =========================

def pdf_mergefile(request):
    return handle_mergefile_request(request)

def pdf_mergepage(request):
    return handle_mergepage_request(request)

def pdf_split(request):
    return handle_split_request(request)

def pdf_rotate(request):
    return handle_rotate_request(request)

def pdf_crop(request):
    return handle_crop_request(request)

def pdf_unlock(request):
    return handle_unlock_request(request)

def pdf_lock(request):
    return handle_lock_request(request)

def pdf_shade(request):
    return handle_shade_request(request)

# =========================
# UTILS
# =========================

def pdf_save_shade(request):
    return save_shade_sample(request)

def download_file(request):
    return HttpResponse("Download is handled via the Merge button.")

# ==========================================
# DWG TO DXF CONVERSION
# ==========================================

def cad_convert_dwg(request):
    if request.method != "POST" or "file" not in request.FILES:
        return JsonResponse(
            {"error": "Please upload a DWG file."},
            status=400
        )

    uploaded = request.FILES["file"]

    if Path(uploaded.name).suffix.lower() != ".dwg":
        return JsonResponse(
            {"error": "Only DWG files can be converted."},
            status=400
        )

    converter = settings.ODA_CONVERTER_PATH

    if not converter or not Path(converter).is_file():
        return JsonResponse({
            "error": "ODA File Converter is not configured."
        }, status=501)

    with tempfile.TemporaryDirectory() as tmp:

        input_dir = Path(tmp) / "input"
        output_dir = Path(tmp) / "output"

        input_dir.mkdir()
        output_dir.mkdir()

        source = input_dir / Path(uploaded.name).name

        with source.open("wb") as destination:
            for chunk in uploaded.chunks():
                destination.write(chunk)

        try:
            subprocess.run(
                [
                    converter,
                    str(input_dir),
                    str(output_dir),
                    "ACAD2018",
                    "DXF",
                    "0",
                    "1",
                    "1"
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=120
            )

        except subprocess.TimeoutExpired:
            return JsonResponse(
                {"error": "DWG conversion timed out."},
                status=504
            )

        except (subprocess.CalledProcessError, OSError) as exc:
            return JsonResponse(
                {"error": str(exc)[:500]},
                status=500
            )

        converted = next(output_dir.rglob("*.dxf"), None)

        if converted is None:
            return JsonResponse(
                {"error": "DXF conversion failed."},
                status=500
            )

        response = HttpResponse(
            converted.read_bytes(),
            content_type="application/dxf"
        )

        response["Content-Disposition"] = (
            'attachment; filename="converted.dxf"'
        )

        return response