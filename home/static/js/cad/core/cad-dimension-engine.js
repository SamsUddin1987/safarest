/**
 * SAFAR EDGE CAD — DIMENSION ENGINE
 * Editable dimension entities, units, styles, layers and visual properties.
 */
(function (global) {
    'use strict';
    const CAD = global.CAD;
    const THREE = global.THREE;
    if (!CAD || !THREE) throw new Error('Dimension engine requires CAD and THREE.');

    const STORAGE_KEY = 'safaredge.cad.dimensionSettings.v1';
    const defaults = {
        currentStyle: 'ISO-25',
        currentLayer: '0',
        units: { lengthType: 'Decimal', lengthPrecision: 0, angleType: 'Decimal Degrees', anglePrecision: 0, insertionScale: 'Millimeters', clockwise: false },
        styles: {
            'ISO-25': {
                name: 'ISO-25', linearFormat: 'Decimal', displayUnit: 'mm',
                precision: 0, angularFormat: 'Decimal Degrees', angularPrecision: 0,
                scale: 1, dimensionScale: 1, prefix: '', suffix: '', textHeight: 2.5, arrowSize: 2.5,
                textGap: 0.8, extensionOffset: 1.25, extensionOvershoot: 1.25,
                dimensionColor: 'ByLayer', extensionColor: 'ByLayer', textColor: 'ByLayer',
                layer: 'DIMENSION', lineweight: 0.18, linetype: 'Continuous',
                textStyle: 'Standard', textFont: 'Arial', textPlacement: 'Above',
                arrowType: 'Closed filled'
            },
            'CIVIL-2.5': {
                name: 'CIVIL-2.5', linearFormat: 'Decimal', displayUnit: 'mm',
                precision: 0, angularFormat: 'Decimal Degrees', angularPrecision: 0,
                scale: 1, dimensionScale: 1, prefix: '', suffix: ' mm', textHeight: 2.5, arrowSize: 2.5,
                textGap: 0.8, extensionOffset: 1.25, extensionOvershoot: 1.25,
                dimensionColor: 'ByLayer', extensionColor: 'ByLayer', textColor: 'ByLayer',
                layer: 'DIMENSION', lineweight: 0.18, linetype: 'Continuous',
                textStyle: 'Standard', textFont: 'Arial', textPlacement: 'Above',
                arrowType: 'Closed filled'
            }
        },
        layers: {
            '0': { name: '0', color: '#ffffff', lineweight: 0.25, linetype: 'Continuous', visible: true, frozen: false, locked: false, plot: true },
            'DIMENSION': { name: 'DIMENSION', color: '#ffff00', lineweight: 0.18, linetype: 'Continuous', visible: true, frozen: false, locked: false, plot: true }
        }
    };

    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function loadSettings() {
        try {
            const saved = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || 'null');
            if (!saved || typeof saved !== 'object') return clone(defaults);
            return {
                currentStyle: saved.currentStyle || defaults.currentStyle,
                styles: Object.assign(clone(defaults.styles), saved.styles || {}),
                layers: Object.assign(clone(defaults.layers), saved.layers || {}),
                currentLayer: saved.currentLayer || defaults.currentLayer,
                units: Object.assign(clone(defaults.units), saved.units || {})
            };
        } catch (_) { return clone(defaults); }
    }
    let settings = loadSettings();
    function save() {
        try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
        catch (_) { /* storage may be unavailable in private browsing */ }
    }
    function currentStyle() {
        return clone(settings.styles[settings.currentStyle] || settings.styles['ISO-25'] || defaults.styles['ISO-25']);
    }
    function getLayer(name) {
        return settings.layers[name] || settings.layers['0'] || defaults.layers['0'];
    }
    function resolveColor(value, layerName) {
        if (!value || value === 'ByLayer') return getLayer(layerName).color;
        if (value === 'ByBlock') return '#ffffff';
        return value;
    }
    const unitFactors = { mm: 1, cm: 10, m: 1000, inch: 25.4, ft: 304.8 };
    function number(value, precision) {
        return Number(value).toFixed(Math.max(0, Math.min(8, Number(precision) || 0)));
    }
    function formatArchitectural(mm, fractional) {
        const totalInches = mm / 25.4;
        const feet = Math.floor(Math.abs(totalInches) / 12);
        const inches = Math.abs(totalInches) - feet * 12;
        const denominator = fractional ? 16 : 1;
        const whole = Math.floor(inches);
        let numerator = Math.round((inches - whole) * denominator);
        let inchWhole = whole;
        if (numerator >= denominator) { inchWhole += 1; numerator = 0; }
        let frac = '';
        if (numerator) {
            let a = numerator, b = denominator;
            while (b) { const t = b; b = a % b; a = t; }
            numerator /= a; const den = denominator / a;
            frac = ` ${numerator}/${den}`;
        }
        const sign = mm < 0 ? '-' : '';
        return `${sign}${feet}'-${inchWhole}${frac}"`;
    }
    function formatLinear(value, style) {
        const scaled = value * (Number(style.scale) || 1);
        const unit = style.displayUnit || 'mm';
        const factor = unitFactors[unit] || 1;
        const display = scaled / factor;
        let result;
        switch (style.linearFormat) {
            case 'Architectural': result = formatArchitectural(scaled, true); break;
            case 'Engineering': result = formatArchitectural(scaled, false); break;
            case 'Fractional': {
                const denom = 16, whole = Math.floor(Math.abs(display));
                let n = Math.round((Math.abs(display) - whole) * denom);
                let a = n, b = denom; while (b) { const t=b; b=a%b; a=t; }
                const fraction = n ? ` ${n/a}/${denom/a}` : '';
                result = `${display < 0 ? '-' : ''}${whole}${fraction}`;
                break;
            }
            case 'Scientific': result = display.toExponential(Math.min(8, Number(style.precision) || 0)); break;
            default: result = number(display, style.precision);
        }
        return `${style.prefix || ''}${result}${style.suffix || (style.linearFormat === 'Decimal' && style.showUnitSuffix ? ` ${unit}` : '')}`;
    }
    function formatAngle(radians, style) {
        const clockwise = !!(settings.units && settings.units.clockwise);
        const displayRadians = clockwise ? ((Math.PI * 2 - radians) % (Math.PI * 2)) : radians;
        let degrees = displayRadians * 180 / Math.PI;
        const precision = Math.max(0, Math.min(6, Number(style.angularPrecision) || 0));
        switch (style.angularFormat) {
            case 'Radians': return `${number(displayRadians, precision)} rad`;
            case 'Gradians': return `${number(degrees * 10 / 9, precision)}g`;
            case 'Degrees Minutes Seconds': {
                const abs = Math.abs(degrees), d = Math.floor(abs), minsFloat = (abs-d)*60;
                const m = Math.floor(minsFloat), sec = (minsFloat-m)*60;
                return `${degrees < 0 ? '-' : ''}${d}°${m}'${number(sec, precision)}"`;
            }
            default: return `${number(degrees, precision)}°`;
        }
    }
    function vec(p) {
        if (p && p.isVector3) return p.clone();
        if (Array.isArray(p)) return new THREE.Vector3(Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0);
        if (p && typeof p === 'object') return new THREE.Vector3(Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0);
        throw new TypeError('Invalid dimension point. Expected Vector3, [x,y,z], or {x,y,z}.');
    }
    // All dimension segments use the same [start, end] pair structure.
    // The previous flattened-vector structure broke DIMANGULAR rendering.
    function addSegment(out, a, b) { out.push([vec(a), vec(b)]); }
    function arrowSegments(out, tip, direction, size, type) {
        const d = vec(direction).normalize();
        const n = new THREE.Vector3(-d.y, d.x, 0);
        const back = vec(tip).addScaledVector(d, size);
        const half = size * 0.34;
        const left = back.clone().addScaledVector(n, half);
        const right = back.clone().addScaledVector(n, -half);
        if (type === 'Open') {
            addSegment(out, left, tip); addSegment(out, tip, right);
        } else if (type === 'Architectural tick') {
            addSegment(out, tip.clone().addScaledVector(n, half), tip.clone().addScaledVector(n, -half));
        } else if (type === 'Dot') {
            const r = size * 0.22;
            for (let i=0;i<12;i++) {
                const a=i*Math.PI/6, b=(i+1)*Math.PI/6;
                addSegment(out,
                    new THREE.Vector3(tip.x+Math.cos(a)*r,tip.y+Math.sin(a)*r,tip.z),
                    new THREE.Vector3(tip.x+Math.cos(b)*r,tip.y+Math.sin(b)*r,tip.z));
            }
        } else {
            addSegment(out, tip, left); addSegment(out, left, right); addSegment(out, right, tip);
        }
    }
    function makeTextSprite(text, position, style, color) {
        const canvas = document.createElement('canvas');
        const fontPx = 64;
        const font = `${fontPx}px ${style.textFont || 'Arial'}`;
        const ctx = canvas.getContext('2d');
        ctx.font = font;
        const metrics = ctx.measureText(text || ' ');
        canvas.width = Math.max(128, Math.ceil(metrics.width + 32));
        canvas.height = 96;
        const c = canvas.getContext('2d');
        c.font = font; c.textBaseline = 'middle'; c.textAlign = 'center';
        c.fillStyle = color; c.fillText(text, canvas.width/2, canvas.height/2);
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: texture, transparent: true, depthTest: false, depthWrite: false
        }));
        const h = Math.max(0.1, (Number(style.textHeight) || 2.5) * (Number(style.dimensionScale)||1));
        sprite.scale.set(Math.max(h*1.2, h * (text.length || 1) * 0.62), h*1.35, 1);
        sprite.position.copy(position);
        sprite.renderOrder = 9000;
        sprite.userData.isDimensionText = true;
        return sprite;
    }
    function makeEntity(segments, text, textPoint, meta, styleOverride) {
        const style = Object.assign(currentStyle(), styleOverride || {});
        const layer = style.layer || 'DIMENSION';
        const dimColor = resolveColor(style.dimensionColor, layer);
        const extColor = resolveColor(style.extensionColor, layer);
        const textColor = resolveColor(style.textColor, layer);
        const extensionCount = Math.max(0, Math.min(segments.length, Number(meta.extensionCount)||0));
        const lineweight = style.lineweight === 'ByLayer' ? getLayer(layer).lineweight : (Number(style.lineweight)||1);
        const lineType = style.linetype === 'ByLayer' ? getLayer(layer).linetype : style.linetype;
        const materialFor = color => lineType && lineType !== 'Continuous'
            ? new THREE.LineDashedMaterial({ color: color, linewidth: lineweight,
                dashSize: lineType === 'Center' ? 4 : 3, gapSize: lineType === 'Dotted' ? 2 : 1.5 })
            : new THREE.LineBasicMaterial({ color: color, linewidth: lineweight });
        const mainSegments = segments.slice(extensionCount);
        const vertices = [];
        mainSegments.forEach(s => vertices.push(vec(s[0]), vec(s[1])));
        const geometry = new THREE.BufferGeometry().setFromPoints(vertices);
        const material = materialFor(dimColor);
        const entity = new THREE.LineSegments(geometry, material);
        if (lineType !== 'Continuous' && entity.computeLineDistances) entity.computeLineDistances();
        if (extensionCount) {
            const extVertices = [];
            segments.slice(0, extensionCount).forEach(s => extVertices.push(vec(s[0]), vec(s[1])));
            const extGeometry = new THREE.BufferGeometry().setFromPoints(extVertices);
            const extMaterial = materialFor(extColor);
            const extEntity = new THREE.LineSegments(extGeometry, extMaterial);
            if (lineType !== 'Continuous' && extEntity.computeLineDistances) extEntity.computeLineDistances();
            extEntity.userData.isDimensionExtension = true;
            entity.add(extEntity);
        }
        entity.userData = {
            type: 'dimension', dimensionType: meta.type, dimensionData: clone(meta),
            dimensionText: text, textOverride: style.textOverride || '', styleName: settings.currentStyle,
            styleSnapshot: clone(style), layer: layer, originalColor: new THREE.Color(dimColor).getHex(),
            properties: { dimensionColor: style.dimensionColor, extensionColor: style.extensionColor,
                textColor: style.textColor, lineweight: style.lineweight, linetype: style.linetype }
        };
        const sprite = makeTextSprite(text, vec(textPoint), style, textColor);
        if (style.textPlacement === 'Aligned' && Number.isFinite(meta.textRotation)) sprite.material.rotation = meta.textRotation;
        entity.add(sprite);
        return entity;
    }
    function createLinear(p1, p2, location, aligned, styleOverride) {
        p1=vec(p1); p2=vec(p2); location=vec(location);
        const style=Object.assign(currentStyle(),styleOverride||{});
        const delta=p2.clone().sub(p1);
        const length=delta.length();
        if (length < 1e-9) return null;
        let u, n, q1, q2, measured;
        if (aligned) {
            u=delta.clone().normalize(); n=new THREE.Vector3(-u.y,u.x,0);
            const mid=p1.clone().add(p2).multiplyScalar(0.5);
            const sign=Math.sign(location.clone().sub(mid).dot(n)) || 1;
            const off=Math.abs(location.clone().sub(mid).dot(n));
            n.multiplyScalar(sign);
            q1=p1.clone().addScaledVector(n,off); q2=p2.clone().addScaledVector(n,off);
            measured=length;
        } else if (Math.abs(delta.x) >= Math.abs(delta.y)) {
            const y=location.y; q1=new THREE.Vector3(p1.x,y,p1.z); q2=new THREE.Vector3(p2.x,y,p2.z);
            n=new THREE.Vector3(0,Math.sign(y-(p1.y+p2.y)/2)||1,0);
            u=new THREE.Vector3(Math.sign(delta.x)||1,0,0); measured=Math.abs(delta.x);
        } else {
            const x=location.x; q1=new THREE.Vector3(x,p1.y,p1.z); q2=new THREE.Vector3(x,p2.y,p2.z);
            n=new THREE.Vector3(Math.sign(x-(p1.x+p2.x)/2)||1,0,0);
            u=new THREE.Vector3(0,Math.sign(delta.y)||1,0); measured=Math.abs(delta.y);
        }
        const offVec=q1.clone().sub(p1), off=offVec.length();
        const dimScale=Number(style.dimensionScale)||1;
        const extOff=(Number(style.extensionOffset)||0)*dimScale, over=(Number(style.extensionOvershoot)||0)*dimScale;
        const e1=p1.clone().addScaledVector(n,extOff), e2=q1.clone().addScaledVector(n,over);
        const e3=p2.clone().addScaledVector(n,extOff), e4=q2.clone().addScaledVector(n,over);
        const text=style.textOverride || formatLinear(measured,style);
        const midpoint=q1.clone().add(q2).multiplyScalar(0.5);
        const gapHalf=style.textPlacement==='Centered'
            ? ((text.length * Number(style.textHeight) * 0.30) + Number(style.textGap||0))*dimScale
            : 0;
        const leftGap=midpoint.clone().addScaledVector(u,-gapHalf);
        const rightGap=midpoint.clone().addScaledVector(u,gapHalf);
        const segs=[[e1,e2],[e3,e4],[q1,leftGap],[rightGap,q2]];
        const as=(Number(style.arrowSize)||2.5)*dimScale;
        arrowSegments(segs,q1,u,as,style.arrowType);
        arrowSegments(segs,q2,u.clone().negate(),as,style.arrowType);
        const textPoint=midpoint.clone();
        if (style.textPlacement === 'Above') textPoint.addScaledVector(n,Number(style.textHeight)*0.7*dimScale);
        const meta={type:aligned?'aligned':'linear',p1:p1.toArray(),p2:p2.toArray(),location:location.toArray(),aligned:!!aligned,measured:measured,extensionCount:2,textRotation:aligned?Math.atan2(delta.y,delta.x):0};
        return makeEntity(segs,text,textPoint,meta,style);
    }
    function createAngular(vertex, ray1, ray2, arcPoint, styleOverride) {
        vertex=vec(vertex); ray1=vec(ray1); ray2=vec(ray2); arcPoint=vec(arcPoint);
        const style=Object.assign(currentStyle(),styleOverride||{});
        const v1=ray1.clone().sub(vertex).normalize(), v2=ray2.clone().sub(vertex).normalize();
        let a1=Math.atan2(v1.y,v1.x), a2=Math.atan2(v2.y,v2.x);
        let sweep=((a2-a1)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);
        const mid=a1+sweep/2;
        const desired=Math.atan2(arcPoint.y-vertex.y,arcPoint.x-vertex.x);
        const test=((desired-a1)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);
        if (test>sweep) { const t=a1; a1=a2; a2=t; sweep=Math.PI*2-sweep; }
        const radius=Math.max(1e-4,arcPoint.distanceTo(vertex));
        const segments=[];
        const steps=Math.max(12,Math.ceil(sweep*24));
        let prev=new THREE.Vector3(vertex.x+Math.cos(a1)*radius,vertex.y+Math.sin(a1)*radius,vertex.z);
        for(let i=1;i<=steps;i++){
            const a=a1+sweep*i/steps;
            const next=new THREE.Vector3(vertex.x+Math.cos(a)*radius,vertex.y+Math.sin(a)*radius,vertex.z);
            addSegment(segments,prev,next); prev=next;
        }
        const end1=vertex.clone().addScaledVector(v1,radius);
        const end2=vertex.clone().addScaledVector(v2,radius);
        addSegment(segments,vertex,end1); addSegment(segments,vertex,end2);
        const t1=new THREE.Vector3(vertex.x+Math.cos(a1)*radius,vertex.y+Math.sin(a1)*radius,vertex.z);
        const t2=new THREE.Vector3(vertex.x+Math.cos(a1+sweep)*radius,vertex.y+Math.sin(a1+sweep)*radius,vertex.z);
        arrowSegments(segments,t1,new THREE.Vector3(-Math.sin(a1),Math.cos(a1),0),style.arrowSize*(Number(style.dimensionScale)||1),style.arrowType);
        arrowSegments(segments,t2,new THREE.Vector3(Math.sin(a1+sweep),-Math.cos(a1+sweep),0),style.arrowSize*(Number(style.dimensionScale)||1),style.arrowType);
        const angle=Math.min(sweep,Math.PI*2-sweep);
        const textPoint=new THREE.Vector3(vertex.x+Math.cos(a1+sweep/2)*(radius+style.textHeight*(Number(style.dimensionScale)||1)),vertex.y+Math.sin(a1+sweep/2)*(radius+style.textHeight*(Number(style.dimensionScale)||1)),vertex.z);
        return makeEntity(segments,style.textOverride || formatAngle(angle,style),textPoint,
            {type:'angular',vertex:vertex.toArray(),ray1:ray1.toArray(),ray2:ray2.toArray(),arcPoint:arcPoint.toArray(),radians:angle},style);
    }
    function createRadial(center, radius, location, diameter, styleOverride) {
        center=vec(center); location=vec(location); radius=Math.abs(Number(radius));
        const style=Object.assign(currentStyle(),styleOverride||{});
        if (!Number.isFinite(radius)||radius<1e-9) return null;
        const dir=location.clone().sub(center);
        if (dir.length()<1e-9) dir.set(1,0,0);
        dir.normalize();
        const edge=center.clone().addScaledVector(dir,radius);
        const opposite=center.clone().addScaledVector(dir,-radius);
        const segs=diameter?[[opposite,edge]]:[[center,edge]];
        if(diameter){
            arrowSegments(segs,edge,dir.clone().negate(),style.arrowSize*(Number(style.dimensionScale)||1),style.arrowType);
            arrowSegments(segs,opposite,dir,style.arrowSize*(Number(style.dimensionScale)||1),style.arrowType);
        }else{
            arrowSegments(segs,edge,dir.clone().negate(),style.arrowSize*(Number(style.dimensionScale)||1),style.arrowType);
        }
        const value=diameter?radius*2:radius;
        const prefix=diameter?'Ø':'R';
        const textBase=diameter?center:edge;
        const textPoint=textBase.clone().addScaledVector(new THREE.Vector3(-dir.y,dir.x,0),style.textHeight*(Number(style.dimensionScale)||1));
        return makeEntity(segs,style.textOverride || `${prefix}${formatLinear(value,style)}`,textPoint,
            {type:diameter?'diameter':'radius',center:center.toArray(),radius:radius,location:location.toArray()},style);
    }
    function createOrdinate(point, location, axis, styleOverride) {
        point=vec(point); location=vec(location);
        const style=Object.assign(currentStyle(),styleOverride||{});
        const elbow=new THREE.Vector3(location.x,point.y,point.z);
        const end=location.clone();
        const segs=[[point,elbow],[elbow,end]];
        const val=axis==='Y'?point.y:point.x;
        const text=style.textOverride || `${axis}=${formatLinear(val,style)}`;
        const textPoint=end.clone().add(new THREE.Vector3(0,style.textHeight*(Number(style.dimensionScale)||1),0));
        return makeEntity(segs,text,textPoint,{type:'ordinate',point:point.toArray(),location:location.toArray(),axis:axis},style);
    }
    function createCenterMark(center, radius) {
        center=vec(center); radius=Math.abs(Number(radius)||5);
        const size=Math.max(radius*0.18,(Number(currentStyle().textHeight)||2.5)*(Number(currentStyle().dimensionScale)||1));
        const segs=[
            [new THREE.Vector3(center.x-size,center.y,center.z),new THREE.Vector3(center.x+size,center.y,center.z)],
            [new THREE.Vector3(center.x,center.y-size,center.z),new THREE.Vector3(center.x,center.y+size,center.z)]
        ];
        const entity=makeEntity(segs,'',center,{type:'center',center:center.toArray(),radius:radius});
        const child=entity.children[0]; if(child){entity.remove(child);child.material.map.dispose();child.material.dispose();}
        entity.userData.dimensionText='';
        return entity;
    }
    function add(entity, context) { if (entity && context) context.addEntity(entity); return entity; }

    function ensureDialogStyles() {
        if (document.getElementById('safar-cad-dialog-styles')) return;
        const style = document.createElement('style');
        style.id = 'safar-cad-dialog-styles';
        style.textContent = `
        #cad-dimension-dialog{position:fixed;inset:0;z-index:25000;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(4,8,14,.76);backdrop-filter:blur(5px);font:13px Inter,Segoe UI,Arial,sans-serif;color:#e7edf5}
        #cad-dimension-dialog .safar-dialog{width:min(1080px,96vw);max-height:min(90vh,900px);display:flex;flex-direction:column;overflow:hidden;background:#171d26;border:1px solid #394555;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.55)}
        #cad-dimension-dialog .safar-head{display:flex;align-items:center;justify-content:space-between;padding:17px 20px;background:linear-gradient(120deg,#202b39,#19212c);border-bottom:1px solid #344253}
        #cad-dimension-dialog .safar-title{font-size:16px;font-weight:650;letter-spacing:.2px;color:#f4f7fb}
        #cad-dimension-dialog .safar-subtitle{font-size:11px;color:#93a4b8;margin-top:4px}
        #cad-dimension-dialog .safar-close{width:32px;height:32px;border:1px solid #465467;border-radius:7px;background:#222d3a;color:#cbd5e1;font-size:20px;line-height:1;cursor:pointer}
        #cad-dimension-dialog .safar-close:hover{background:#9f343d;border-color:#c95b63;color:white}
        #cad-dimension-dialog .safar-body{padding:18px 20px;overflow:auto;min-height:220px}
        #cad-dimension-dialog .safar-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 20px;background:#141a22;border-top:1px solid #344253}
        #cad-dimension-dialog .safar-actions{display:flex;gap:8px;align-items:center}
        #cad-dimension-dialog .safar-btn{border:1px solid #46576b;border-radius:7px;background:#263344;color:#e5edf7;padding:8px 13px;font-size:12px;font-weight:600;cursor:pointer}
        #cad-dimension-dialog .safar-btn:hover{background:#33465d}
        #cad-dimension-dialog .safar-btn.primary{background:#176b9c;border-color:#2589c2;color:#fff}
        #cad-dimension-dialog .safar-btn.primary:hover{background:#2185bd}
        #cad-dimension-dialog .safar-btn.danger{background:#48262b;border-color:#754047;color:#ffdce0}
        #cad-dimension-dialog .safar-field{display:flex;flex-direction:column;gap:6px;min-width:0}
        #cad-dimension-dialog .safar-field>span{font-size:11px;font-weight:600;color:#aebdce}
        #cad-dimension-dialog input:not([type=checkbox]),#cad-dimension-dialog select{width:100%;min-width:0;box-sizing:border-box;background:#101720;color:#e7edf5;border:1px solid #3b4b5e;border-radius:6px;padding:8px 9px;font:12px Segoe UI,Arial,sans-serif;outline:none}
        #cad-dimension-dialog input:focus,#cad-dimension-dialog select:focus{border-color:#36a1d6;box-shadow:0 0 0 2px rgba(54,161,214,.15)}
        #cad-dimension-dialog input[type=color]{height:34px;padding:3px}
        #cad-dimension-dialog .safar-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid #354355;margin-bottom:16px}
        #cad-dimension-dialog .safar-tab{border:0;border-bottom:2px solid transparent;background:transparent;color:#9eafc2;padding:10px 13px;font-size:12px;cursor:pointer}
        #cad-dimension-dialog .safar-tab.active{color:#eaf6ff;border-bottom-color:#35a2d6;background:rgba(53,162,214,.08)}
        #cad-dimension-dialog .safar-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px 18px}
        #cad-dimension-dialog .safar-section-title{font-size:12px;color:#e4edf7;font-weight:700;margin:0 0 12px;padding-bottom:8px;border-bottom:1px solid #334154}
        #cad-dimension-dialog .safar-hint{font-size:11px;line-height:1.5;color:#8294a8}
        #cad-dimension-dialog .safar-manager{display:grid;grid-template-columns:220px minmax(0,1fr);gap:18px;min-height:440px}
        #cad-dimension-dialog .safar-sidebar{background:#121923;border:1px solid #2f3d4e;border-radius:8px;padding:12px}
        #cad-dimension-dialog .safar-style-list{display:flex;flex-direction:column;gap:4px;margin:10px 0}
        #cad-dimension-dialog .safar-style-item{padding:9px 10px;border:1px solid transparent;border-radius:6px;background:transparent;color:#bdc9d7;text-align:left;cursor:pointer}
        #cad-dimension-dialog .safar-style-item.active{background:#203b50;border-color:#28658a;color:#fff}
        #cad-dimension-dialog .safar-preview{margin-top:16px;padding:14px;border:1px solid #344456;border-radius:8px;background:#101720}
        #cad-dimension-dialog .safar-table-wrap{overflow:auto;border:1px solid #354456;border-radius:8px}
        #cad-dimension-dialog table{width:100%;border-collapse:collapse;min-width:760px;font-size:11px}
        #cad-dimension-dialog th{position:sticky;top:0;background:#222e3c;color:#aebdd0;text-align:left;font-weight:650;padding:10px 8px;border-bottom:1px solid #3b4b5e;white-space:nowrap}
        #cad-dimension-dialog td{padding:7px 8px;border-bottom:1px solid #2b3746;color:#d9e2ed;white-space:nowrap}
        #cad-dimension-dialog tr:hover td{background:#202d3b}
        #cad-dimension-dialog .safar-layer-control{max-width:130px}
        #cad-dimension-dialog .safar-status{font-size:11px;color:#8fc9e8;min-height:16px}
        @media(max-width:760px){#cad-dimension-dialog{padding:8px}#cad-dimension-dialog .safar-dialog{width:100%;max-height:96vh}#cad-dimension-dialog .safar-manager{grid-template-columns:1fr}#cad-dimension-dialog .safar-grid{grid-template-columns:1fr}#cad-dimension-dialog .safar-body{padding:12px}}
        `;
        document.head.appendChild(style);
    }
    function openDialog(title, subtitle='Professional CAD settings') {
        ensureDialogStyles();
        const old=document.getElementById('cad-dimension-dialog'); if(old)old.remove();
        const overlay=document.createElement('div'); overlay.id='cad-dimension-dialog';
        const panel=document.createElement('section'); panel.className='safar-dialog'; panel.setAttribute('role','dialog'); panel.setAttribute('aria-modal','true');
        const header=document.createElement('header'); header.className='safar-head';
        const titleWrap=document.createElement('div');
        const heading=document.createElement('div'); heading.className='safar-title'; heading.textContent=title;
        const sub=document.createElement('div'); sub.className='safar-subtitle'; sub.textContent=subtitle;
        titleWrap.append(heading,sub);
        const closeX=document.createElement('button'); closeX.className='safar-close'; closeX.type='button'; closeX.title='Close (Esc)'; closeX.setAttribute('aria-label','Close'); closeX.textContent='×';
        header.append(titleWrap,closeX);
        const body=document.createElement('div'); body.className='safar-body';
        const footer=document.createElement('footer'); footer.className='safar-footer';
        const hint=document.createElement('div'); hint.className='safar-hint'; hint.textContent='Changes are stored in this browser profile.';
        const actions=document.createElement('div'); actions.className='safar-actions'; footer.append(hint,actions);
        panel.append(header,body,footer); overlay.append(panel); document.body.append(overlay);
        let closed=false;
        const close=()=>{if(closed)return;closed=true;document.removeEventListener('keydown',onKey,true);overlay.remove();};
        const onKey=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}};
        document.addEventListener('keydown',onKey,true);
        closeX.addEventListener('click',close);
        overlay.addEventListener('mousedown',e=>{if(e.target===overlay)close();});
        const addButton=(text,primary,fn,kind='')=>{const b=document.createElement('button');b.type='button';b.className='safar-btn'+(primary?' primary':'')+(kind?' '+kind:'');b.textContent=text;b.addEventListener('click',fn);actions.append(b);return b;};
        const field=(parent,label,control)=>{const wrap=document.createElement('label');wrap.className='safar-field';const cap=document.createElement('span');cap.textContent=label;wrap.append(cap,control);parent.append(wrap);return control;};
        const input=(value,type='text',step='any')=>{const el=document.createElement('input');el.type=type;el.value=value??'';if(type==='number')el.step=step;return el;};
        const select=(value,options)=>{const el=document.createElement('select');options.forEach(v=>{const op=document.createElement('option');op.value=String(v);op.textContent=String(v);el.append(op);});el.value=String(value);return el;};
        const section=(parent,titleText)=>{const h=document.createElement('h3');h.className='safar-section-title';h.textContent=titleText;parent.append(h);};
        return {overlay,panel,body,actions,footer,close,button:addButton,field,input,select,section};
    }
    function openStyleManager() {
        const ui=openDialog('Dimension Style Manager','Create, organize and apply reusable dimension standards');
        const manager=document.createElement('div');manager.className='safar-manager';ui.body.append(manager);
        const sidebar=document.createElement('aside');sidebar.className='safar-sidebar';
        const main=document.createElement('div');manager.append(sidebar,main);
        const styleHead=document.createElement('div');styleHead.className='safar-section-title';styleHead.textContent='Available styles';sidebar.append(styleHead);
        const styleList=document.createElement('div');styleList.className='safar-style-list';sidebar.append(styleList);
        const styleStatus=document.createElement('div');styleStatus.className='safar-status';sidebar.append(styleStatus);
        const tabs=document.createElement('div');tabs.className='safar-tabs';main.append(tabs);
        const panel=document.createElement('div');main.append(panel);
        const preview=document.createElement('div');preview.className='safar-preview';preview.innerHTML='<div class="safar-section-title">Preview</div><svg viewBox="0 0 560 88" width="100%" height="88" role="img" aria-label="Dimension style preview"><path d="M70 55V25 M470 55V25 M70 38H470 M70 33L82 38L70 43 M470 33L458 38L470 43" fill="none" stroke="#5bc0e8" stroke-width="1.5"/><text x="270" y="27" fill="#e9f2fa" text-anchor="middle" font-size="14">2500</text><path d="M70 55H470" stroke="#7891a8" stroke-width="1"/></svg><div class="safar-hint">Illustrative preview. Actual dimensions use the selected style and drawing scale.</div>';
        panel.append(preview);
        const tabNames=['Lines','Symbols & Arrows','Text','Fit','Primary Units'];
        const specs={
          'Lines':[['layer','Dimension layer','select',()=>Object.keys(settings.layers)],['dimensionColor','Dimension line colour','color'],['extensionColor','Extension line colour','color'],['lineweight','Lineweight','select',()=>['ByLayer','Default','0.00','0.05','0.09','0.13','0.15','0.18','0.20','0.25','0.30','0.35','0.40','0.50','0.53','0.60','0.70','0.80','1.00','1.06','1.20','1.40','1.58','2.00','2.11']],['linetype','Linetype','select',()=>['ByLayer','Continuous','Dashed','Hidden','Center','Dotted']],['extensionOffset','Extension line offset','number'],['extensionOvershoot','Extension line overshoot','number']],
          'Symbols & Arrows':[['arrowType','Arrowhead type','select',()=>['Closed filled','Open','Dot','Architectural tick']],['arrowSize','Arrow size','number'],['centerMarkSize','Center mark size','number'],['textGap','Text gap','number']],
          'Text':[['textFont','Text font','select',()=>['Arial','Arial Narrow','Calibri','Tahoma','Verdana','Times New Roman','Consolas']],['textHeight','Text height','number'],['textColor','Text colour','color'],['textPlacement','Text placement','select',()=>['Above','Centered','Aligned']],['textStyle','Text style','text']],
          'Fit':[['dimensionScale','Overall dimension scale','number'],['scale','Measurement scale factor','number'],['fitMode','Fit preference','select',()=>['Best fit','Text only','Arrows only','Always keep text between extension lines']],['textOutside','Allow text outside','select',()=>['true','false']],['arrowsOutside','Allow arrows outside','select',()=>['true','false']]],
          'Primary Units':[['linearFormat','Linear unit format','select',()=>['Decimal','Architectural','Engineering','Fractional','Scientific']],['displayUnit','Display unit','select',()=>['mm','cm','m','inch','ft']],['precision','Linear precision','select',()=>['0','1','2','3','4','5','6','7','8']],['angularFormat','Angular unit format','select',()=>['Decimal Degrees','Degrees Minutes Seconds','Gradians','Radians']],['angularPrecision','Angular precision','select',()=>['0','1','2','3','4','5','6']],['prefix','Text prefix','text'],['suffix','Text suffix','text']]
        };
        let activeTab=tabNames[0], activeName=settings.currentStyle;
        const controls={};
        function controlFor(key,kind,value){let el;if(kind==='select')el=ui.select(value,specs[activeTab].find(x=>x[0]===key)[3]());else if(kind==='number')el=ui.input(value,'number');else if(kind==='color'){el=ui.input(value&&value.startsWith('#')?value:getLayer(style.layer).color,'color');}else el=ui.input(value);return el;}
        function current(){return settings.styles[activeName]||currentStyle();}
        function saveVisibleToStyle(){const st=Object.assign({},settings.styles[activeName]||currentStyle());Object.keys(controls).forEach(k=>{const el=controls[k];let v=el && el.mode ? (el.mode.value==='Custom'?el.color.value:el.mode.value) : el.value;if(k==='precision'||k==='angularPrecision')v=Number(v);if(['arrowSize','centerMarkSize','textGap','textHeight','dimensionScale','scale','extensionOffset','extensionOvershoot'].includes(k))v=Number(v);if(k==='lineweight')v=v==='Default'?0:(v==='ByLayer'?'ByLayer':Number(v));if(k==='textOutside'||k==='arrowsOutside')v=v==='true';st[k]=v;});settings.styles[activeName]=st;}
        function renderTabs(){tabs.innerHTML='';tabNames.forEach(t=>{const b=document.createElement('button');b.type='button';b.className='safar-tab'+(t===activeTab?' active':'');b.textContent=t;b.onclick=()=>{saveVisibleToStyle();activeTab=t;renderTabs();renderFields();};tabs.append(b);});}
        function renderFields(){panel.querySelectorAll('.safar-fields').forEach(x=>x.remove());const grid=document.createElement('div');grid.className='safar-grid safar-fields';const st=current();Object.keys(controls).forEach(k=>delete controls[k]);specs[activeTab].forEach(([key,label,kind])=>{let value=st[key];if(value===undefined){value=key==='centerMarkSize'?2.5:key==='fitMode'?'Best fit':key==='textOutside'||key==='arrowsOutside'?'true':'';}let el;if(kind==='select')el=ui.select(value,specs[activeTab].find(x=>x[0]===key)[3]());else if(kind==='number')el=ui.input(value,'number');else if(kind==='color'){const wrap=document.createElement('div');wrap.style.cssText='display:grid;grid-template-columns:110px 1fr;gap:7px';const mode=ui.select(String(value).startsWith('#')?'Custom':(value||'ByLayer'),['ByLayer','ByBlock','Custom']);const color=ui.input(String(value).startsWith('#')?value:getLayer(st.layer).color,'color');color.disabled=mode.value!=='Custom';mode.onchange=()=>{color.disabled=mode.value!=='Custom';};wrap.append(mode,color);el={mode,color};}else el=ui.input(value);controls[key]=el;ui.field(grid,label,el);});panel.insertBefore(grid,preview);}
        function renderStyleList(){styleList.innerHTML='';Object.keys(settings.styles).sort().forEach(n=>{const b=document.createElement('button');b.type='button';b.className='safar-style-item'+(n===activeName?' active':'');b.textContent=n+(n===settings.currentStyle?'  ✓':'');b.onclick=()=>{saveVisibleToStyle();activeName=n;renderStyleList();renderFields();};styleList.append(b);});}
        ui.button('New style',false,()=>{saveVisibleToStyle();const n=global.prompt('New dimension style name:','CUSTOM');if(!n)return;if(settings.styles[n]){styleStatus.textContent='That style name already exists.';return;}settings.styles[n]=Object.assign({},current(),{name:n});activeName=n;renderStyleList();renderFields();});
        ui.button('Rename',false,()=>{if(activeName==='ISO-25'){styleStatus.textContent='The standard ISO-25 style is protected.';return;}const n=global.prompt('Rename style:',activeName);if(!n||settings.styles[n])return;saveVisibleToStyle();settings.styles[n]=Object.assign({},settings.styles[activeName],{name:n});delete settings.styles[activeName];if(settings.currentStyle===activeName)settings.currentStyle=n;activeName=n;renderStyleList();renderFields();});
        ui.button('Delete',false,()=>{if(activeName==='ISO-25'){styleStatus.textContent='The standard ISO-25 style cannot be deleted.';return;}if(!global.confirm(`Delete dimension style ${activeName}?`))return;delete settings.styles[activeName];activeName=settings.currentStyle in settings.styles?settings.currentStyle:'ISO-25';renderStyleList();renderFields();});
        ui.button('Close',false,ui.close);
        ui.button('Set Current & Apply',true,()=>{saveVisibleToStyle();settings.currentStyle=activeName;save();ui.close();refreshAll();if(global.notify)global.notify(`Dimension style ${activeName} is current.`);});
        renderTabs();renderStyleList();renderFields();
    }
    function applyLayerState(entity) {
        if (!entity) return;
        entity.userData = entity.userData || {};
        const layerName = entity.userData.layer || '0';
        const layer = getLayer(layerName);
        entity.userData.layer = layerName;
        entity.userData.layerLocked = layer.locked === true;
        entity.userData.layerLineweight = layer.lineweight;
        entity.userData.layerLinetype = layer.linetype || 'Continuous';
        entity.visible = layer.visible !== false && layer.frozen !== true;

        // Ordinary CAD entities default to ByLayer. Imported entities can
        // explicitly opt out with colorMode:'Explicit' to preserve DXF colour.
        const colorMode = entity.userData.colorMode || (entity.userData.type === 'dimension' ? 'DimensionStyle' : 'ByLayer');
        if (colorMode === 'ByLayer' && entity.userData.type !== 'dimension') {
            const hex = new THREE.Color(layer.color || '#ffffff').getHex();
            entity.userData.originalColor = hex;
            const applyMaterial = (node) => {
                if (!node.material) return;
                const lineType = layer.linetype || 'Continuous';
                const dash = lineType === 'Dashed' ? [8, 4] :
                    lineType === 'Hidden' ? [4, 3] :
                    lineType === 'Center' ? [12, 3, 3, 3] :
                    lineType === 'Dotted' ? [1, 3] : null;
                const oldMaterials = Array.isArray(node.material) ? node.material : [node.material];
                const updated = oldMaterials.map(material => {
                    if (!material) return material;
                    const isLine = !!(node.isLine || node.isLineSegments || node.isLineLoop);
                    const wantsDash = isLine && !!dash;
                    const isDashed = !!material.isLineDashedMaterial;
                    if (wantsDash !== isDashed) {
                        const options = {
                            color: hex,
                            linewidth: Number(layer.lineweight) || 1,
                            transparent: material.transparent,
                            opacity: material.opacity,
                            depthTest: material.depthTest,
                            depthWrite: material.depthWrite
                        };
                        if (wantsDash) {
                            options.dashSize = dash[0];
                            options.gapSize = dash[1];
                            const replacement = new THREE.LineDashedMaterial(options);
                            material.dispose();
                            return replacement;
                        }
                        const replacement = new THREE.LineBasicMaterial(options);
                        material.dispose();
                        return replacement;
                    }
                    if (material.color) material.color.setHex(hex);
                    material.userData = material.userData || {};
                    material.userData.cadLineweight = layer.lineweight;
                    material.userData.cadLinetype = lineType;
                    material.needsUpdate = true;
                    return material;
                });
                node.material = Array.isArray(node.material) ? updated : updated[0];
                // Three.js dashed lines require cumulative line distances.
                if (dash && typeof node.computeLineDistances === 'function') node.computeLineDistances();
                // Preserve plot metadata even on platforms where WebGL ignores linewidth.
                const finalMaterials = Array.isArray(node.material) ? node.material : [node.material];
                finalMaterials.forEach(material => {
                    if (!material) return;
                    material.userData = material.userData || {};
                    material.userData.cadLineweight = layer.lineweight;
                    material.userData.cadLinetype = lineType;
                });
            };
            if (typeof entity.traverse === 'function') entity.traverse(applyMaterial);
            else applyMaterial(entity);
        }
    }
    function applyLayerStates() {
        try { CAD.createContext().getObjects().forEach(applyLayerState); } catch (_) {}
    }
    function openLayerManager() {
        const ui=openDialog('Layer Properties Manager','Organize drawing layers, appearance and layer state');
        const toolbar=document.createElement('div');toolbar.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px';ui.body.append(toolbar);
        const tableWrap=document.createElement('div');tableWrap.className='safar-table-wrap';ui.body.append(tableWrap);
        const table=document.createElement('table');tableWrap.append(table);
        const head=document.createElement('thead');head.innerHTML='<tr><th>Current</th><th>Layer</th><th>On</th><th>Freeze</th><th>Lock</th><th>Colour</th><th>Linetype</th><th>Lineweight</th><th>Plot</th></tr>';table.append(head);
        const body=document.createElement('tbody');table.append(body);
        let selected=settings.currentLayer||'0';
        function redraw(){body.innerHTML='';Object.keys(settings.layers).forEach(name=>{const l=settings.layers[name];const tr=document.createElement('tr');const td=(node)=>{const c=document.createElement('td');c.append(node);tr.append(c);return c;};
            const radio=document.createElement('input');radio.type='radio';radio.name='safar-current-layer';radio.checked=selected===name;radio.onchange=()=>{selected=name;};td(radio);
            const nm=document.createElement('strong');nm.textContent=name;td(nm);
            [['visible','On'],['frozen','Freeze'],['locked','Lock'],['plot','Plot']].forEach(([key])=>{const cb=document.createElement('input');cb.type='checkbox';cb.checked=l[key]!==false;cb.onchange=()=>{l[key]=cb.checked;save();applyLayerStates();};td(cb);});
            const color=document.createElement('input');color.type='color';color.className='safar-layer-control';color.value=l.color||'#ffffff';color.onchange=()=>{l.color=color.value;save();applyLayerStates();refreshAll();};td(color);
            const lt=document.createElement('select');lt.className='safar-layer-control';['Continuous','Dashed','Hidden','Center','Dotted'].forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;lt.append(o);});lt.value=l.linetype||'Continuous';lt.onchange=()=>{l.linetype=lt.value;save();applyLayerStates();refreshAll();};td(lt);
            const lw=document.createElement('select');lw.className='safar-layer-control';['Default','0.00','0.05','0.09','0.13','0.15','0.18','0.20','0.25','0.30','0.35','0.40','0.50','0.53','0.60','0.70','0.80','1.00','1.06','1.20','1.40','1.58','2.00','2.11'].forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v==='Default'?v:v+' mm';lw.append(o);});lw.value=String(l.lineweight||'Default');lw.onchange=()=>{l.lineweight=lw.value==='Default'?0:Number(lw.value);save();applyLayerStates();refreshAll();};td(lw);
            body.append(tr);
        });}
        const toolBtn=(text,fn,primary=false)=>{const b=document.createElement('button');b.type='button';b.className='safar-btn'+(primary?' primary':'');b.textContent=text;b.onclick=fn;toolbar.append(b);};
        toolBtn('New layer',()=>{const n=global.prompt('New layer name:','LAYER-'+(Object.keys(settings.layers).length));if(!n||settings.layers[n])return;settings.layers[n]={name:n,color:'#ffffff',lineweight:0.25,linetype:'Continuous',visible:true,frozen:false,locked:false,plot:true};selected=n;redraw();save();});
        toolBtn('Set current',()=>{settings.currentLayer=selected;save();applyLayerStates();if(global.notify)global.notify(`Current layer: ${selected}`);redraw();});
        toolBtn('Rename',()=>{if(selected==='0')return;const oldName=selected;const n=global.prompt('Rename layer:',oldName);if(!n||settings.layers[n])return;settings.layers[n]=Object.assign({},settings.layers[oldName],{name:n});delete settings.layers[oldName];if(settings.currentLayer===oldName)settings.currentLayer=n;try{CAD.createContext().getObjects().forEach(o=>{if(o.userData&&o.userData.layer===oldName)o.userData.layer=n;});}catch(_){}selected=n;save();redraw();applyLayerStates();});
        toolBtn('Delete',()=>{if(selected==='0'){global.alert('Layer 0 cannot be deleted.');return;}if(!global.confirm(`Delete layer ${selected}?`))return;const oldName=selected;delete settings.layers[oldName];try{CAD.createContext().getObjects().forEach(o=>{if(o.userData&&o.userData.layer===oldName)o.userData.layer='0';});}catch(_){}if(settings.currentLayer===oldName)settings.currentLayer='0';selected=settings.currentLayer;save();redraw();applyLayerStates();},false);
        const status=document.createElement('div');status.className='safar-status';status.style.marginTop='10px';status.textContent='Layer properties are stored with the dimension/layer settings profile.';ui.body.append(status);
        ui.button('Close',false,ui.close);ui.button('Apply & Close',true,()=>{settings.currentLayer=selected;save();applyLayerStates();ui.close();refreshAll();});
        redraw();
    }
    function refreshEntity(entity, useCurrent) {
        if(!entity||!entity.userData||entity.userData.type!=='dimension')return;
        const data=entity.userData.dimensionData||{};
        const style=useCurrent?currentStyle():(settings.styles[entity.userData.styleName]||entity.userData.styleSnapshot||currentStyle());
        style.textOverride = entity.userData.textOverride || '';
        let fresh=null;
        if(data.type==='linear'||data.type==='aligned')fresh=createLinear(vec(data.p1),vec(data.p2),vec(data.location),data.type==='aligned',style);
        else if(data.type==='angular')fresh=createAngular(vec(data.vertex),vec(data.ray1),vec(data.ray2),vec(data.arcPoint),style);
        else if(data.type==='radius'||data.type==='diameter')fresh=createRadial(vec(data.center),data.radius,vec(data.location),data.type==='diameter',style);
        else if(data.type==='ordinate')fresh=createOrdinate(vec(data.point),vec(data.location),data.axis,style);
        if(!fresh)return;
        const parent=entity.parent;
        if(parent)parent.remove(entity);
        entity.geometry.dispose();entity.material.dispose();
        while(entity.children.length){const c=entity.children[0];entity.remove(c);if(c.material){if(c.material.map)c.material.map.dispose();c.material.dispose();}}
        entity.geometry=fresh.geometry;entity.material=fresh.material;entity.userData=fresh.userData;
        while(fresh.children.length){const c=fresh.children[0];fresh.remove(c);entity.add(c);}
        if(parent)parent.add(entity);
        fresh.geometry=null;fresh.material=null;
    }
    function refreshAll() {
        const ctx=CAD.createContext();
        ctx.getObjects().filter(o=>o.userData&&o.userData.type==='dimension').forEach(o=>refreshEntity(o,true));
    }

    function setTextOverride(entity, text) {
        if(!entity||!entity.userData||entity.userData.type!=='dimension')return false;
        const style=Object.assign(currentStyle(),entity.userData.styleSnapshot||{});
        const color=resolveColor(style.textColor,entity.userData.layer||style.layer);
        const old=entity.children.find(c=>c.userData&&c.userData.isDimensionText);
        if(old){entity.remove(old);if(old.material){if(old.material.map)old.material.map.dispose();old.material.dispose();}}
        entity.userData.textOverride=String(text||'');
        if(!text){refreshEntity(entity,true);return true;}
        entity.userData.dimensionText=String(text);
        const pos=new THREE.Vector3();
        entity.geometry.computeBoundingBox();
        const b=entity.geometry.boundingBox;
        if(b)pos.set((b.min.x+b.max.x)/2,(b.min.y+b.max.y)/2+Number(style.textHeight)*0.7,0);
        entity.add(makeTextSprite(String(text),pos,style,color));
        return true;
    }
    function openUnitsManager() {
        const ui=openDialog('Drawing Units','Configure drawing measurement, insertion scale and angular conventions');
        const units=Object.assign({},defaults.units,settings.units||{});
        const tabs=document.createElement('div');tabs.className='safar-tabs';ui.body.append(tabs);
        const content=document.createElement('div');content.className='safar-grid';ui.body.append(content);
        const controls={};
        const groups={
          'Length':[['lengthType','Length type',['Decimal','Architectural','Engineering','Fractional','Scientific']],['lengthPrecision','Length precision',['0','1','2','3','4','5','6','7','8']],['insertionScale','Insertion scale',['Unitless','Millimeters','Centimeters','Meters','Inches','Feet','US Survey Feet']]],
          'Angle':[['angleType','Angle type',['Decimal Degrees','Degrees Minutes Seconds','Gradians','Radians']],['anglePrecision','Angular precision',['0','1','2','3','4','5','6']],['clockwise','Clockwise angles',['false','true']]]
        };
        let active='Length';
        function captureUnits(){Object.keys(controls).forEach(k=>{let v=controls[k].value;if(k==='lengthPrecision'||k==='anglePrecision')v=Number(v);if(k==='clockwise')v=v==='true';units[k]=v;});}
        function render(){captureUnits();tabs.innerHTML='';content.innerHTML='';Object.keys(groups).forEach(g=>{const b=document.createElement('button');b.type='button';b.className='safar-tab'+(active===g?' active':'');b.textContent=g;b.onclick=()=>{active=g;render();};tabs.append(b);});
          groups[active].forEach(([key,label,opts])=>{const el=ui.select(units[key],opts);controls[key]=el;ui.field(content,label,el);});
          const note=document.createElement('div');note.className='safar-hint';note.style.gridColumn='1/-1';note.textContent=active==='Length'?'Length units control drawing-unit conventions and the default dimension display. Existing geometry coordinates are not rescaled by changing this setting.':'Angular settings control displayed angular values. Geometry remains stored in radians internally.';content.append(note);
        }
        ui.button('Cancel',false,ui.close);
        ui.button('Apply',true,()=>{captureUnits();settings.units=units;const st=Object.assign({},settings.styles[settings.currentStyle]);st.linearFormat=units.lengthType;st.precision=units.lengthPrecision;st.displayUnit=({Millimeters:'mm',Centimeters:'cm',Meters:'m',Inches:'inch',Feet:'ft','US Survey Feet':'ft',Unitless:st.displayUnit})[units.insertionScale]||st.displayUnit;st.angularFormat=units.angleType;st.angularPrecision=units.anglePrecision;settings.styles[settings.currentStyle]=st;save();ui.close();refreshAll();});
        render();
    }
    CAD.Dimension = {
        settings,

        getSettings: () => clone(settings),

        setSettings(projectSettings) {
            if (!projectSettings || typeof projectSettings !== 'object') {
                return false;
            }

            const restored = {
                currentStyle: projectSettings.currentStyle || defaults.currentStyle,
                styles: Object.assign(clone(defaults.styles), clone(projectSettings.styles || {})),
                layers: Object.assign(clone(defaults.layers), clone(projectSettings.layers || {})),
                currentLayer: projectSettings.currentLayer || '0',
                units: Object.assign(clone(defaults.units), clone(projectSettings.units || {}))
            };

            Object.keys(settings).forEach(key => delete settings[key]);
            Object.assign(settings, restored);

            save();
            applyLayerStates();
            refreshAll();

            return true;
        },

        currentStyle,
        getLayer,
        saveSettings: save,
        getCurrentLayer:()=>settings.currentLayer||'0', getUnits:()=>clone(settings.units||defaults.units), applyLayerState, applyLayerStates,
        formatLinear, formatAngle, createLinear, createAngular, createRadial, createOrdinate, createCenterMark,
        add, openStyleManager, openLayerManager, openUnitsManager, refreshEntity, refreshAll, setTextOverride,
        setCurrentStyle(name){if(settings.styles[name]){settings.currentStyle=name;save();return true;}return false;},
        setLayer(name,props){settings.layers[name]=Object.assign({name,color:'#ffffff',lineweight:0.25,linetype:'Continuous',visible:true,frozen:false,locked:false,plot:true},props||{});save();applyLayerStates();},
        setCurrentLayer(name){if(!settings.layers[name])return false;settings.currentLayer=name;save();return true;},
        getLastLinear(){return lastLinear;},
        setLastLinear(value){lastLinear=value?clone(value):null;}
    };
    let lastLinear=null;
    save();
    // Reconcile entities created before the layer manager was initialized.
    try { applyLayerStates(); } catch (_) {}

})(window);
