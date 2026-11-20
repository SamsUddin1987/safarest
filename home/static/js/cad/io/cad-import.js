// ==========================================
// DXF / DWG FILE IMPORT
// ==========================================

let importedCadObjects = [];

function cadSetFileStatus(message, error = false) {

    const el = document.getElementById("cad-file-status");

    if (el) {
        el.textContent = message;
        el.style.color = error ? "#ff7777" : "#9ee7d8";
    }
}

function cadAddLine(points, color = 0xe6e6e6, closed = false) {

    if (!points || points.length < 2) return;

    const coords = points.map(p =>
        new THREE.Vector3(
            Number(p.x) || 0,
            Number(p.y) || 0,
            0
        )
    );

    if (closed && coords.length > 2) {
        coords.push(coords[0].clone());
    }

    const geometry = new THREE.BufferGeometry()
        .setFromPoints(coords);

    const material = new THREE.LineBasicMaterial({
        color: color
    });

    const line = new THREE.Line(geometry, material);

    line.userData.importedCAD = true;

    scene.add(line);

    drawnObjects.push(line);
    importedCadObjects.push(line);
}


function cadColorForEntity(entity) {

    if (Number.isFinite(entity.trueColor)) {
        return entity.trueColor;
    }

    if (Number.isFinite(entity.color) && entity.color > 0) {

        const aci = [
            0xffffff,
            0xff0000,
            0xffff00,
            0x00ff00,
            0x00ffff,
            0x0000ff,
            0xff00ff
        ];

        return aci[entity.color] || 0xe6e6e6;
    }

    return 0xe6e6e6;
}


// ==========================================
// RENDER DXF ENTITIES
// ==========================================

function cadRenderDxf(dxf) {

    if (!dxf || !Array.isArray(dxf.entities)) {
        throw new Error("Invalid DXF drawing.");
    }

    // Remove previously imported drawing

    importedCadObjects.forEach(obj => {

        scene.remove(obj);

        obj.geometry?.dispose();
        obj.material?.dispose();

    });

    drawnObjects = drawnObjects.filter(
        obj => !obj.userData?.importedCAD
    );

    importedCadObjects = [];


    dxf.entities.forEach(entity => {

        const color = cadColorForEntity(entity);

        switch ((entity.type || "").toUpperCase()) {

            case "LINE":

                cadAddLine(
                    [entity.start, entity.end],
                    color
                );

                break;


            case "LWPOLYLINE":
            case "POLYLINE":

                cadAddLine(
                    entity.vertices || [],
                    color,
                    !!(entity.shape || entity.closed)
                );

                break;


            case "CIRCLE": {

                const c = entity.center;
                const r = Number(entity.radius);

                if (c && r > 0) {

                    const points = [];

                    for (let i = 0; i <= 96; i++) {

                        const angle = (i / 96) * Math.PI * 2;

                        points.push({
                            x: c.x + Math.cos(angle) * r,
                            y: c.y + Math.sin(angle) * r
                        });

                    }

                    cadAddLine(points, color);
                }

                break;
            }


            case "ARC": {

                const c = entity.center;
                const r = Number(entity.radius);

                if (c && r > 0) {

                    let start = Number(entity.startAngle) || 0;
                    let end = Number(entity.endAngle) || 0;

                    while (end < start) {
                        end += Math.PI * 2;
                    }

                    const steps = Math.max(
                        12,
                        Math.ceil((end - start) * 24)
                    );

                    const points = [];

                    for (let i = 0; i <= steps; i++) {

                        const angle =
                            start + (end - start) * i / steps;

                        points.push({
                            x: c.x + Math.cos(angle) * r,
                            y: c.y + Math.sin(angle) * r
                        });

                    }

                    cadAddLine(points, color);
                }

                break;
            }


            case "POINT": {

                const p = entity.position;

                if (p) {

                    cadAddLine([
                        { x: p.x - 1, y: p.y },
                        { x: p.x + 1, y: p.y }
                    ], color);

                    cadAddLine([
                        { x: p.x, y: p.y - 1 },
                        { x: p.x, y: p.y + 1 }
                    ], color);

                }

                break;
            }

        }

    });


    if (!importedCadObjects.length) {
        throw new Error(
            "No supported drawing entities found."
        );
    }

    zoomExtents();

    cadSetFileStatus(
        "Drawing loaded: " + importedCadObjects.length + " elements"
    );
}


// ==========================================
// CSRF COOKIE
// ==========================================

function cadGetCookie(name) {

    const match = document.cookie.match(
        new RegExp("(^| )" + name + "=([^;]+)")
    );

    return match ? decodeURIComponent(match[2]) : "";
}


// ==========================================
// OPEN DXF / DWG FILE
// ==========================================

async function cadOpenFile(file) {

    if (!file) return;

    const extension = file.name
        .split(".")
        .pop()
        .toLowerCase();

    cadSetFileStatus("Opening " + file.name + "...");

    try {

        let drawingText;

        // DXF FILE

        if (extension === "dxf") {

            drawingText = await file.text();

        }

        // DWG FILE

        else if (extension === "dwg") {

            const tools = document.querySelector(
                ".cad-file-tools"
            );

            const endpoint = tools.dataset.convertUrl;

            const formData = new FormData();

            formData.append("file", file);

            const response = await fetch(endpoint, {

                method: "POST",

                headers: {
                    "X-CSRFToken": cadGetCookie("csrftoken")
                },

                body: formData

            });

            if (!response.ok) {

                const data = await response.json();

                throw new Error(
                    data.error || "DWG conversion failed."
                );

            }

            drawingText = await response.text();

        }

        else {

            throw new Error(
                "Please select a DXF or DWG file."
            );

        }


        // CHECK DXF PARSER

        if (typeof DxfParser === "undefined") {

            throw new Error(
                "DXF parser library not loaded."
            );

        }


        // PARSE DRAWING

        const parser = new DxfParser();

        const parsedDrawing = parser.parseSync(
            drawingText
        );

        // DISPLAY DRAWING

        cadRenderDxf(parsedDrawing);

    }

    catch (error) {

        console.error("CAD Import Error:", error);

        cadSetFileStatus(
            error.message || "Unable to open drawing.",
            true
        );

    }

}


// ==========================================
// FILE INPUT EVENT
// ==========================================

document.addEventListener("DOMContentLoaded", function() {

    const input = document.getElementById(
        "cad-file-input"
    );

    if (input) {

        input.addEventListener("change", function(event) {

            cadOpenFile(event.target.files[0]);

        });

    }

});